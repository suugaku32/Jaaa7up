import { useMemo, useState } from 'react';
import { Board } from './Board';
import type { PlyEval } from '../analysis/analyze';
import type { UsiEngine } from '../engine/UsiEngine';
import { scoreToCp } from '../analysis/classify';
import { Position } from '../shogi/position';
import { generateLegalMoves, moveToUsi } from '../shogi/moveGen';
import { formatUsiMoveAsKif } from '../shogi/notation';
import type { Move, PieceType, Square } from '../shogi/types';
import { sameSquare, usiToSquare } from '../shogi/types';
import './TrainingMode.css';

/** A user answer counts as correct if it loses at most this much vs the engine's best. */
const ACCEPT_MARGIN_CP = 50;

type Verdict =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'correct'; playedCp: number; bestCp: number; usi: string }
  | { kind: 'wrong'; playedCp: number; bestCp: number; usi: string }
  | { kind: 'revealed' };

interface TrainingModeProps {
  blunders: PlyEval[];
  engine: UsiEngine | null;
  movetimeMs: number;
  flipped?: boolean;
  blackName?: string;
  whiteName?: string;
}

export function TrainingMode({
  blunders,
  engine,
  movetimeMs,
  flipped,
  blackName,
  whiteName,
}: TrainingModeProps) {
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<
    { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null
  >(null);
  const [errorSquare, setErrorSquare] = useState<Square | null>(null);
  const [verdict, setVerdict] = useState<Verdict>({ kind: 'idle' });
  const [promptPromotion, setPromptPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [solved, setSolved] = useState<Set<number>>(new Set());

  const current = blunders[idx];

  const position = useMemo(
    () => (current ? Position.fromSfen(current.sfenBefore) : null),
    [current],
  );

  const legalMoves = useMemo(
    () => (position ? generateLegalMoves(position, position.turn) : []),
    [position],
  );

  if (!current || !position) {
    return (
      <div className="training-empty">
        <p>Aucune gaffe détectée dans cette partie — rien à réviser ici.</p>
      </div>
    );
  }

  const destinations = (): Square[] => {
    if (!selected) return [];
    if (selected.kind === 'hand') {
      return legalMoves.filter((m) => !m.from && m.piece === selected.type).map((m) => m.to);
    }
    return legalMoves
      .filter((m) => m.from && sameSquare(m.from, selected.sq))
      .map((m) => m.to);
  };

  const flashError = (sq: Square) => {
    setErrorSquare(sq);
    setTimeout(() => setErrorSquare(null), 450);
  };

  const submitMove = async (usi: string) => {
    if (!engine) return;
    setVerdict({ kind: 'checking' });
    const after = await engine.analyze(current.sfenBefore, [usi], { movetimeMs });
    // Score comes back from the opponent's perspective — flip it to the mover's.
    const playedCp = -scoreToCp(after.scoreCp, after.scoreMate);
    const bestCp = current.evalBeforeCp;
    const correct = bestCp - playedCp <= ACCEPT_MARGIN_CP;
    if (correct) {
      setSolved((s) => new Set(s).add(idx));
      setVerdict({ kind: 'correct', playedCp, bestCp, usi });
    } else {
      flashError(usiToSquare(usi.slice(2, 4)));
      setVerdict({ kind: 'wrong', playedCp, bestCp, usi });
    }
  };

  const tryMove = (to: Square) => {
    if (!selected || verdict.kind === 'checking') return;
    const candidates: Move[] = legalMoves.filter((m) => {
      if (!sameSquare(m.to, to)) return false;
      if (selected.kind === 'hand') return !m.from && m.piece === selected.type;
      return m.from != null && sameSquare(m.from, selected.sq);
    });
    setSelected(null);
    if (candidates.length === 0) {
      flashError(to);
      return;
    }
    const promoting = candidates.filter((m) => m.promote);
    const plain = candidates.filter((m) => !m.promote);
    if (promoting.length > 0 && plain.length > 0) {
      setPromptPromotion({ from: plain[0].from!, to });
      return;
    }
    void submitMove(moveToUsi(candidates[0]));
  };

  const onSquareClick = (sq: Square) => {
    if (verdict.kind === 'checking' || promptPromotion) return;
    const piece = position.pieceAt(sq);
    if (selected?.kind === 'square' && sameSquare(selected.sq, sq)) {
      setSelected(null);
      return;
    }
    if (piece && piece.color === position.turn) {
      setSelected({ kind: 'square', sq });
      return;
    }
    if (selected) tryMove(sq);
  };

  const onHandPieceClick = (type: PieceType) => {
    if (verdict.kind === 'checking' || promptPromotion) return;
    if (selected?.kind === 'hand' && selected.type === type) {
      setSelected(null);
      return;
    }
    setSelected({ kind: 'hand', type });
  };

  const resolvePromotion = (promote: boolean) => {
    if (!promptPromotion) return;
    const { from, to } = promptPromotion;
    setPromptPromotion(null);
    const move = legalMoves.find(
      (m) => m.from && sameSquare(m.from, from) && sameSquare(m.to, to) && m.promote === promote,
    );
    if (move) void submitMove(moveToUsi(move));
  };

  const goTo = (next: number) => {
    setIdx(next);
    setSelected(null);
    setVerdict({ kind: 'idle' });
    setPromptPromotion(null);
    setErrorSquare(null);
  };

  const playedLabel =
    verdict.kind === 'correct' || verdict.kind === 'wrong'
      ? formatUsiMoveAsKif(position, verdict.usi, null)
      : '';
  const bestLabel = current.bestMove
    ? formatUsiMoveAsKif(position, current.bestMove, null)
    : '—';
  const actualLabel = formatUsiMoveAsKif(position, current.moveUsi, null);

  return (
    <div className="training">
      <div className="training-head">
        <div className="training-progress">
          <strong>
            Gaffe {idx + 1} / {blunders.length}
          </strong>
          <span className="training-solved">{solved.size} résolue(s)</span>
        </div>
        <div className="training-nav">
          <button className="btn btn-ghost" onClick={() => goTo(idx - 1)} disabled={idx === 0}>
            ‹ Précédente
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => goTo(idx + 1)}
            disabled={idx >= blunders.length - 1}
          >
            Suivante ›
          </button>
        </div>
      </div>

      <p className="training-prompt">
        Coup {current.ply} — c'est à{' '}
        <strong>
          {current.color === 'b' ? '▲ Sente' : '△ Gote'}
          {(current.color === 'b' ? blackName : whiteName)
            ? ` (${current.color === 'b' ? blackName : whiteName})`
            : ''}
        </strong>{' '}
        de jouer. Dans la partie, ce coup a coûté{' '}
        <strong>{(current.centipawnLoss / 100).toFixed(1)}</strong> points. Trouvez mieux.
      </p>

      <div className="training-body">
        <Board
          position={position}
          interactive={verdict.kind !== 'correct' && verdict.kind !== 'revealed'}
          selected={selected}
          legalDestinations={destinations()}
          errorSquare={errorSquare}
          handSide={position.turn}
          flipped={flipped}
          blackName={blackName}
          whiteName={whiteName}
          onSquareClick={onSquareClick}
          onHandPieceClick={onHandPieceClick}
        />

        <div className="training-side">
          {promptPromotion && (
            <div className="promo-prompt">
              <span>Promouvoir ?</span>
              <button className="btn btn-primary" onClick={() => resolvePromotion(true)}>
                成 Oui
              </button>
              <button className="btn btn-ghost" onClick={() => resolvePromotion(false)}>
                Non
              </button>
            </div>
          )}

          {verdict.kind === 'idle' && !promptPromotion && (
            <p className="training-hint">
              Sélectionnez une pièce puis sa case d'arrivée. Les coups légaux sont surlignés.
            </p>
          )}
          {verdict.kind === 'checking' && <p className="training-hint">Analyse du coup…</p>}

          {(verdict.kind === 'correct' || verdict.kind === 'wrong') && (
            <div className={`verdict verdict-${verdict.kind}`}>
              <strong>
                {verdict.kind === 'correct' ? '✓ Bien joué' : '✗ Insuffisant'} — {playedLabel}
              </strong>
              <span>
                Votre coup : {(verdict.playedCp / 100).toFixed(2)} · Meilleur :{' '}
                {(verdict.bestCp / 100).toFixed(2)}
              </span>
              {verdict.kind === 'wrong' && (
                <button className="btn btn-ghost" onClick={() => setVerdict({ kind: 'idle' })}>
                  Réessayer
                </button>
              )}
            </div>
          )}

          {verdict.kind === 'revealed' && (
            <div className="verdict verdict-revealed">
              <strong>Meilleur coup : {bestLabel}</strong>
              <span>Coup joué dans la partie : {actualLabel}</span>
            </div>
          )}

          {verdict.kind !== 'revealed' && verdict.kind !== 'correct' && (
            <button className="btn btn-ghost" onClick={() => setVerdict({ kind: 'revealed' })}>
              Voir la solution
            </button>
          )}

          {(verdict.kind === 'correct' || verdict.kind === 'revealed') &&
            idx < blunders.length - 1 && (
              <button className="btn btn-primary" onClick={() => goTo(idx + 1)}>
                Gaffe suivante ›
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
