import { useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { Ref } from 'react';
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
  /**
   * Temps de réflexion accordé au moteur pour répondre. Réglé au-dehors : le
   * curseur vit dans le panneau « Explorer », pas sous le plateau, où il
   * repoussait la navigation hors de l'écran.
   */
  replyMs: number;
  /**
   * Le moteur répond-il ? Décoché, les deux camps se jouent à la main : c'est
   * ainsi qu'on déroule une idée à soi, ou qu'on rejoue une variante lue
   * ailleurs, sans qu'un adversaire s'invite à chaque coup.
   */
  autoReply: boolean;
  /**
   * Appelé au premier coup joué hors de la partie. Le panneau des réglages
   * d'exploration n'a d'intérêt qu'à partir de là : c'est le moment de le
   * montrer, plutôt que de laisser chercher où l'on règle ce qui vient de
   * changer sous les yeux.
   */
  onBranchStart?: () => void;
  /**
   * Signale l'état de la variante au parent : c'est lui qui porte les chevrons
   * flottants, et il doit savoir s'ils commandent la partie ou la variante.
   */
  onBranchState?: (state: { moves: number; thinking: boolean }) => void;
  ref?: Ref<ExploreBoardHandle>;
}

/**
 * Ce que le parent peut demander au plateau. Les chevrons vivent au-dehors —
 * ils flottent en bas de l'écran — mais dans une variante ce sont ces deux
 * gestes-là qu'ils doivent commander.
 */
export interface ExploreBoardHandle {
  /** Joue le coup que le moteur choisit dans la position courante. */
  playEngineMove: () => Promise<void>;
  /** Revient d'un coup (ou de deux, si le moteur avait répondu). */
  undo: () => void;
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
  replyMs,
  autoReply,
  onBranchStart,
  onBranchState,
  ref,
}: ExploreBoardProps) {
  const [branch, setBranch] = useState<{ base: string; moves: string[] } | null>(null);
  const [selected, setSelected] = useState<
    { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null
  >(null);
  const [promptPromotion, setPromptPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [thinking, setThinking] = useState(false);
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

  /**
   * Demande son coup au moteur dans la position donnée et le joue.
   *
   * Le score renvoyé est celui du camp au trait dans cette position : on le
   * retourne pour l'afficher toujours du point de vue de celui qui vient de
   * jouer.
   */
  const engineMove = useCallback(
    async (base: string, moves: string[]) => {
      setThinking(true);
      setEngineError(null);
      try {
        const engine = await ensureEngine();
        const r = await engine.analyze(base, moves, { movetimeMs: replyMs });
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
    },
    [ensureEngine, replyMs],
  );

  const play = async (usi: string) => {
    const base = branch?.base ?? baseSfen;
    const moves = (branch?.moves ?? []).concat(usi);
    if (!replay(base, moves)) return;
    if (!branch) onBranchStart?.();
    setBranch({ base, moves });
    setSelected(null);
    // Sans réponse du moteur, rien à attendre : le coup est joué, la main passe
    // à l'autre camp, et c'est l'utilisateur qui la tient. Le chevron « › » reste
    // là pour lui demander son coup quand on veut le voir.
    if (!autoReply) {
      setEvalCp(null);
      return;
    }
    await engineMove(base, moves);
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
    /*
     * Deux coups quand le moteur répond : le nôtre et sa réponse. En retirer un
     * seul rendrait la main à l'adversaire, ce qui n'est pas ce qu'on veut en
     * revenant en arrière. Quand on joue les deux camps, un seul coup suffit —
     * c'est la main d'avant qu'on veut reprendre.
     */
    const step = autoReply ? 2 : 1;
    const moves = branch.moves.slice(0, Math.max(0, branch.moves.length - step));
    setBranch(moves.length ? { base: branch.base, moves } : null);
    setEvalCp(null);
    setSelected(null);
  };

  /*
   * Les chevrons flottants commandent la variante dès qu'elle existe : « › »
   * demande son coup au moteur — c'est la seule façon de le voir quand la
   * réponse automatique est coupée —, « ‹ » revient en arrière.
   */
  useImperativeHandle(
    ref,
    () => ({
      playEngineMove: async () => {
        if (!branch || thinking) return;
        await engineMove(branch.base, branch.moves);
      },
      undo,
    }),
    [branch, thinking, engineMove, undo],
  );

  useEffect(() => {
    onBranchState?.({ moves: branch?.moves.length ?? 0, thinking });
  }, [branch, thinking, onBranchState]);

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
    </div>
  );
}

/**
 * Les réglages de l'exploration, séparés du plateau parce qu'ils se règlent une
 * fois et se lisent rarement — alors que le plateau et la navigation servent à
 * chaque coup. Ils vivent donc dans le panneau « Explorer ».
 */
export function ExploreSettings({
  replyMs,
  onReplyMs,
  autoReply,
  onAutoReply,
  showArrowB,
  onShowArrowB,
  showArrowW,
  onShowArrowW,
}: {
  replyMs: number;
  onReplyMs: (ms: number) => void;
  autoReply: boolean;
  onAutoReply: (on: boolean) => void;
  showArrowB: boolean;
  onShowArrowB: (on: boolean) => void;
  showArrowW: boolean;
  onShowArrowW: (on: boolean) => void;
}) {
  return (
    <div className="explore-settings">
      <label className="explore-toggle">
        <input
          type="checkbox"
          checked={autoReply}
          onChange={(e) => onAutoReply(e.target.checked)}
        />
        <span>Le moteur répond</span>
      </label>

      {/* Le curseur ne s'affiche que s'il commande quelque chose. */}
      {autoReply && (
        <label className="explore-time">
          <span>Temps de réflexion</span>
          <input
            type="range"
            min={200}
            max={10000}
            step={100}
            value={replyMs}
            onChange={(e) => onReplyMs(Number(e.target.value))}
            aria-label="Temps de réflexion du moteur"
          />
          <output>{(replyMs / 1000).toFixed(1).replace('.', ',')} s</output>
        </label>
      )}

      {/*
       * Par camp plutôt qu'une seule case : suivre le trait de Sente sans se
       * faire souffler la réponse de Gote (ou l'inverse) demande de pouvoir
       * couper l'un sans l'autre. La flèche verte reste celle du coup
       * recommandé (voir `App.tsx`), juste affichée au bon moment.
       */}
      <label className="explore-toggle">
        <input
          type="checkbox"
          checked={showArrowB}
          onChange={(e) => onShowArrowB(e.target.checked)}
        />
        <span>Flèche Sente</span>
      </label>
      <label className="explore-toggle">
        <input
          type="checkbox"
          checked={showArrowW}
          onChange={(e) => onShowArrowW(e.target.checked)}
        />
        <span>Flèche Gote</span>
      </label>
    </div>
  );
}
