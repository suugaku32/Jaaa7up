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
  bestMovePv: string[];
  centipawnLoss: number;
  quality: MoveQuality;
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

export interface AnalyzeGameOptions {
  movetimeMs?: number;
  depth?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

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
    opts.onProgress?.(i + 1, total);
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
      centipawnLoss: loss,
      quality: classifyLoss(winDrop),
    });

    posAt.applyUsiMove(moveUsi);
    evalCurve.push({
      ply: i + 1,
      cpForBlack: mover === 'b' ? evalAfterCp : -evalAfterCp,
    });
  }

  const blunders = plies.filter((p) => p.quality === 'blunder');
  const mistakes = plies.filter((p) => p.quality === 'mistake');

  return { startSfen, plies, evalCurve, blunders, mistakes };
}
