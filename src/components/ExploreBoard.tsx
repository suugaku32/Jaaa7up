import { useEffect, useMemo, useState } from 'react';
import { Board } from './Board';
import type { BoardArrow } from './Board';
import type { UsiEngine } from '../engine/UsiEngine';
import { scoreToCp } from '../analysis/classify';
import { Position } from '../shogi/position';
import { generateLegalMoves, moveToUsi } from '../shogi/moveGen';
import { formatUsiMoveAsKif } from '../shogi/notation';
import type { Move, PieceType, Square } from '../shogi/types';
import { sameSquare, usiToSquare } from '../shogi/types';
import './ExploreBoard.css';

interface ExploreBoardProps {
  /** Position de la partie actuellement affichée : le point de départ possible. */
  baseSfen: string;
  ensureEngine: () => Promise<UsiEngine>;
  flipped?: boolean;
  blackName?: string;
  whiteName?: string;
  /** Flèche du coup recommandé, tant qu'on n'a pas quitté la partie. */
  gameArrows?: BoardArrow[];
  lastMove?: { from: Square | null; to: Square } | null;
}

/** Rejoue une séquence depuis un SFEN. `null` si elle est invalide. */
function replay(sfen: string, moves: string[]): Position | null {
  try {
    const p = Position.fromSfen(sfen);
    for (const m of moves) p.applyUsiMove(m);
    return p;
  } catch {
    return null;
  }
}

/**
 * Le plateau d'analyse, mais jouable.
 *
 * « Et si j'avais joué ça ? » est la question qu'on se pose devant une partie,
 * et à laquelle une courbe ne répond pas. Jouer un coup ouvre un embranchement :
 * la partie n'est plus suivie, le moteur répond, et l'on voit où ça mène.
 *
 * Le temps de réponse est réglable parce qu'il arbitre entre deux usages —
 * dérouler vite une idée, ou éprouver sérieusement une position. Une seconde
 * suffit pour la première, dix ne sont pas de trop pour la seconde.
 */
export function ExploreBoard({
  baseSfen,
  ensureEngine,
  flipped,
  blackName,
  whiteName,
  gameArrows,
  lastMove,
}: ExploreBoardProps) {
  const [branch, setBranch] = useState<{ base: string; moves: string[] } | null>(null);
  const [selected, setSelected] = useState<
    { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null
  >(null);
  const [promptPromotion, setPromptPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [replyMs, setReplyMs] = useState(1000);
  const [evalCp, setEvalCp] = useState<number | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  /*
   * Naviguer dans la partie abandonne l'embranchement. L'alternative — le
   * garder et rendre la main plus tard — obligerait à choisir en permanence
   * entre deux positions affichées, pour une idée qu'on explore le plus souvent
   * d'un trait.
   */
  useEffect(() => {
    setBranch(null);
    setSelected(null);
    setEvalCp(null);
    setEngineError(null);
  }, [baseSfen]);

  const position = useMemo(
    () => (branch ? (replay(branch.base, branch.moves) ?? Position.fromSfen(baseSfen)) : Position.fromSfen(baseSfen)),
    [branch, baseSfen],
  );

  const legalMoves = useMemo(
    () => generateLegalMoves(position, position.turn),
    [position],
  );

  const labels = useMemo(() => {
    if (!branch) return [];
    const out: string[] = [];
    const p = Position.fromSfen(branch.base);
    let previous: Square | null = null;
    for (const usi of branch.moves) {
      out.push(formatUsiMoveAsKif(p, usi, previous));
      previous = usiToSquare(usi.slice(2, 4));
      p.applyUsiMove(usi);
    }
    return out;
  }, [branch]);

  const play = async (usi: string) => {
    const base = branch?.base ?? baseSfen;
    const moves = (branch?.moves ?? []).concat(usi);
    if (!replay(base, moves)) return;
    setBranch({ base, moves });
    setSelected(null);
    setThinking(true);
    setEngineError(null);
    try {
      const engine = await ensureEngine();
      const r = await engine.analyze(base, moves, { movetimeMs: replyMs });
      // Le moteur parle du point de vue du camp au trait après notre coup.
      setEvalCp(-scoreToCp(r.scoreCp, r.scoreMate));
      const reply = r.bestMove;
      // `bestmove resign` : le moteur s'avoue battu. Il n'y a pas de coup à
      // jouer, et lui en inventer un serait mentir sur ce qu'il a dit.
      if (reply && replay(base, moves.concat(reply))) {
        setBranch({ base, moves: moves.concat(reply) });
      }
    } catch (e) {
      setEngineError((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const destinations = (): Square[] => {
    if (!selected || thinking) return [];
    if (selected.kind === 'hand') {
      return legalMoves.filter((m) => !m.from && m.piece === selected.type).map((m) => m.to);
    }
    return legalMoves.filter((m) => m.from && sameSquare(m.from, selected.sq)).map((m) => m.to);
  };

  const tryMove = (to: Square) => {
    if (!selected || thinking) return;
    const from = selected;
    const candidates: Move[] = legalMoves.filter((m) => {
      if (!sameSquare(m.to, to)) return false;
      if (from.kind === 'hand') return !m.from && m.piece === from.type;
      return m.from != null && sameSquare(m.from, from.sq);
    });
    setSelected(null);
    if (candidates.length === 0) return;
    const promoting = candidates.filter((m) => m.promote);
    const plain = candidates.filter((m) => !m.promote);
    if (promoting.length > 0 && plain.length > 0) {
      setPromptPromotion({ from: plain[0].from!, to });
      return;
    }
    void play(moveToUsi(candidates[0]));
  };

  const onSquareClick = (sq: Square) => {
    if (thinking || promptPromotion) return;
    if (selected?.kind === 'square' && sameSquare(selected.sq, sq)) {
      setSelected(null);
      return;
    }
    const piece = position.pieceAt(sq);
    if (piece && piece.color === position.turn) {
      setSelected({ kind: 'square', sq });
      return;
    }
    if (selected) tryMove(sq);
  };

  const onHandPieceClick = (type: PieceType) => {
    if (thinking || promptPromotion) return;
    setSelected((s) => (s?.kind === 'hand' && s.type === type ? null : { kind: 'hand', type }));
  };

  const resolvePromotion = (promote: boolean) => {
    if (!promptPromotion) return;
    const { from, to } = promptPromotion;
    setPromptPromotion(null);
    const move = legalMoves.find(
      (m) => m.from && sameSquare(m.from, from) && sameSquare(m.to, to) && m.promote === promote,
    );
    if (move) void play(moveToUsi(move));
  };

  const undo = () => {
    if (!branch) return;
    // Deux coups : le nôtre et la réponse. En retirer un seul rendrait la main
    // à l'adversaire, ce qui n'est pas ce qu'on veut en revenant en arrière.
    const moves = branch.moves.slice(0, Math.max(0, branch.moves.length - 2));
    setBranch(moves.length ? { base: branch.base, moves } : null);
    setEvalCp(null);
    setSelected(null);
  };

  const branchLastMove = branch?.moves.length
    ? (() => {
        const usi = branch.moves[branch.moves.length - 1];
        return {
          from: usi.includes('*') ? null : usiToSquare(usi.slice(0, 2)),
          to: usiToSquare(usi.slice(2, 4)),
        };
      })()
    : null;

  return (
    <div className="analysis-board">
      <Board
        position={position}
        lastMove={branch ? branchLastMove : lastMove}
        interactive={!thinking}
        selected={selected}
        legalDestinations={destinations()}
        handSide={position.turn}
        flipped={flipped}
        arrows={branch ? undefined : gameArrows}
        blackName={blackName}
        whiteName={whiteName}
        onSquareClick={onSquareClick}
        onHandPieceClick={onHandPieceClick}
      />

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

      {!branch && !promptPromotion && (
        <p className="explore-hint">
          Jouez un coup sur le plateau pour ouvrir une variante : le moteur répondra.
        </p>
      )}

      {branch && (
        <div className="explore-branch">
          <div className="explore-branch-head">
            <span className="explore-branch-label">Votre variante</span>
            {evalCp !== null && !thinking && (
              <span className="explore-eval">{evalCp > 0 ? `+${Math.round(evalCp)}` : Math.round(evalCp)}</span>
            )}
            {thinking && <span className="explore-thinking">le moteur réfléchit…</span>}
          </div>
          <p className="explore-moves">{labels.join('  ')}</p>
          <div className="explore-actions">
            <button className="btn btn-ghost" onClick={undo} disabled={thinking}>
              ‹ Reculer
            </button>
            <button className="btn btn-ghost" onClick={() => setBranch(null)} disabled={thinking}>
              ↺ Revenir à la partie
            </button>
          </div>
        </div>
      )}

      {engineError && <p className="explore-hint">Le moteur n’a pas pu répondre : {engineError}</p>}

      <label className="explore-time">
        <span>Réponse du moteur</span>
        <input
          type="range"
          min={200}
          max={10000}
          step={100}
          value={replyMs}
          onChange={(e) => setReplyMs(Number(e.target.value))}
          disabled={thinking}
          aria-label="Temps de réflexion du moteur"
        />
        <output>{(replyMs / 1000).toFixed(1).replace('.', ',')} s</output>
      </label>
    </div>
  );
}
