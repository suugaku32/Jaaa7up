import type { UsiEngine } from '../engine/UsiEngine';
import { Position } from '../shogi/position';
import type { Color } from '../shogi/types';
import { classifyLoss, cpToWinPercent, scoreToCp, type MoveQuality } from './classify';

export interface PlyEval {
  ply: number; // 1-indexed: the move played to go from sfenBefore to sfenAfter
  moveUsi: string;
  color: Color;
  sfenBefore: string;
  sfenAfter: string;
  /** Engine cp score at sfenBefore, from the mover's perspective (≈ value of the best move). */
  evalBeforeCp: number;
  /** Engine cp score at sfenAfter, converted to the mover's perspective. */
  evalAfterCp: number;
  bestMove: string | null;
  /** Ce que le moteur aurait joué à la place, et la suite qu'il envisage. */
  bestMovePv: string[];
  /** La suite après le coup réellement joué : c'est elle qui montre pourquoi il est mauvais. */
  refutationPv: string[];
  centipawnLoss: number;
  quality: MoveQuality;
  /** True once the second pass has re-examined this ply at the deeper time control. */
  refined?: boolean;
}

export interface EvalPoint {
  ply: number;
  /** Positive = advantage for black (sente). */
  cpForBlack: number;
}

export interface AnalysisResult {
  startSfen: string;
  plies: PlyEval[];
  evalCurve: EvalPoint[];
  blunders: PlyEval[];
  mistakes: PlyEval[];
}

export type AnalysisPhase = 'scan' | 'refine';

export interface AnalyzeGameOptions {
  /** Time per position for the first pass, which sweeps the whole game. */
  movetimeMs?: number;
  /** Time per position for the second pass, which re-examines suspect moves only. */
  deepMovetimeMs?: number;
  depth?: number;
  onProgress?: (phase: AnalysisPhase, done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Qualities worth spending the second pass on. */
const REFINED_QUALITIES: MoveQuality[] = ['inaccuracy', 'mistake', 'blunder'];

export async function analyzeGame(
  engine: UsiEngine,
  startSfen: string,
  moves: string[],
  opts: AnalyzeGameOptions = {},
): Promise<AnalysisResult> {
  const sfens: string[] = [startSfen];
  const pos = Position.fromSfen(startSfen);
  for (const m of moves) {
    pos.applyUsiMove(m);
    sfens.push(pos.toSfen());
  }

  // Pass 1 — sweep every position quickly, just to locate the suspect moves.
  const total = sfens.length;
  const evals: { cp: number; bestMove: string | null; pv: string[] }[] = [];
  for (let i = 0; i < sfens.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Analyse annulée', 'AbortError');
    const result = await engine.analyze(sfens[i], [], {
      movetimeMs: opts.movetimeMs,
      depth: opts.depth,
    });
    evals.push({
      cp: scoreToCp(result.scoreCp, result.scoreMate),
      bestMove: result.bestMove,
      pv: result.pv,
    });
    opts.onProgress?.('scan', i + 1, total);
  }

  const plies: PlyEval[] = [];
  const evalCurve: EvalPoint[] = [];
  const posAt = Position.fromSfen(startSfen);
  evalCurve.push({
    ply: 0,
    cpForBlack: posAt.turn === 'b' ? evals[0].cp : -evals[0].cp,
  });

  for (let i = 0; i < moves.length; i++) {
    const mover: Color = posAt.turn;
    const evalBeforeCp = evals[i].cp;
    const evalAfterFromNextMoverCp = evals[i + 1].cp;
    const evalAfterCp = -evalAfterFromNextMoverCp; // back to `mover`'s perspective
    const loss = Math.max(0, evalBeforeCp - evalAfterCp);
    const winBefore = cpToWinPercent(evalBeforeCp);
    const winAfter = cpToWinPercent(evalAfterCp);
    const winDrop = Math.max(0, winBefore - winAfter);

    const sfenBefore = sfens[i];
    const sfenAfter = sfens[i + 1];
    const moveUsi = moves[i];

    plies.push({
      ply: i + 1,
      moveUsi,
      color: mover,
      sfenBefore,
      sfenAfter,
      evalBeforeCp,
      evalAfterCp,
      bestMove: evals[i].bestMove,
      bestMovePv: evals[i].pv,
      refutationPv: evals[i + 1].pv,
      centipawnLoss: loss,
      quality: classifyLoss(winDrop),
    });

    posAt.applyUsiMove(moveUsi);
    evalCurve.push({
      ply: i + 1,
      cpForBlack: mover === 'b' ? evalAfterCp : -evalAfterCp,
    });
  }

  // Pass 2 — re-examine only the suspect moves, with a much longer search.
  // The first pass is too shallow to be trusted as the answer key in training
  // mode, and it also mislabels some moves in both directions.
  const deepMs = opts.deepMovetimeMs;
  if (deepMs && deepMs > (opts.movetimeMs ?? 0)) {
    const candidates = plies.filter((p) => REFINED_QUALITIES.includes(p.quality));
    // A ply needs its own position and the one after it; consecutive candidates share.
    const needed = new Set<number>();
    for (const p of candidates) {
      needed.add(p.ply - 1);
      needed.add(p.ply);
    }
    const indices = [...needed].sort((a, b) => a - b);
    const deep = new Map<number, { cp: number; bestMove: string | null; pv: string[] }>();

    for (let k = 0; k < indices.length; k++) {
      if (opts.signal?.aborted) throw new DOMException('Analyse annulée', 'AbortError');
      const i = indices[k];
      const r = await engine.analyze(sfens[i], [], { movetimeMs: deepMs });
      deep.set(i, {
        cp: scoreToCp(r.scoreCp, r.scoreMate),
        bestMove: r.bestMove,
        pv: r.pv,
      });
      opts.onProgress?.('refine', k + 1, indices.length);
    }

    for (const p of candidates) {
      const before = deep.get(p.ply - 1);
      const after = deep.get(p.ply);
      if (!before || !after) continue;
      p.evalBeforeCp = before.cp;
      p.evalAfterCp = -after.cp;
      p.bestMove = before.bestMove;
      p.bestMovePv = before.pv;
      p.refutationPv = after.pv;
      p.centipawnLoss = Math.max(0, p.evalBeforeCp - p.evalAfterCp);
      p.quality = classifyLoss(
        Math.max(0, cpToWinPercent(p.evalBeforeCp) - cpToWinPercent(p.evalAfterCp)),
      );
      p.refined = true;
    }

    // Keep the curve consistent with the deepened values.
    for (const p of candidates) {
      const point = evalCurve[p.ply];
      if (point) point.cpForBlack = p.color === 'b' ? p.evalAfterCp : -p.evalAfterCp;
    }
  }

  const blunders = plies.filter((p) => p.quality === 'blunder');
  const mistakes = plies.filter((p) => p.quality === 'mistake');

  return { startSfen, plies, evalCurve, blunders, mistakes };
}
