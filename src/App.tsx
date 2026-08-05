import { useCallback, useMemo, useRef, useState } from 'react';
import { Board } from './components/Board';
import { EvalGraph } from './components/EvalGraph';
import { KifuInput } from './components/KifuInput';
import { MoveList } from './components/MoveList';
import { TrainingMode } from './components/TrainingMode';
import { UsiEngine, engineEnvironmentIssues } from './engine/UsiEngine';
import { analyzeGame } from './analysis/analyze';
import type { AnalysisResult } from './analysis/analyze';
import { QUALITY_LABEL_FR } from './analysis/classify';
import { parseKifu } from './shogi/parser';
import type { ParsedGame } from './shogi/parser';
import { Position } from './shogi/position';
import { formatUsiMoveAsKif } from './shogi/notation';
import type { Square } from './shogi/types';
import { usiToSquare } from './shogi/types';
import './App.css';

type Tab = 'analysis' | 'training';

type Phase =
  | { kind: 'input' }
  | { kind: 'analyzing'; done: number; total: number }
  | { kind: 'done' };

export default function App() {
  const [kifuText, setKifuText] = useState('');
  const [movetimeMs, setMovetimeMs] = useState(400);
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [game, setGame] = useState<ParsedGame | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [currentPly, setCurrentPly] = useState(0);
  const [tab, setTab] = useState<Tab>('analysis');
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<UsiEngine | null>(null);

  const envIssues = useMemo(() => engineEnvironmentIssues(), []);

  const moveLabels = useMemo(() => {
    if (!game) return [];
    const labels: string[] = [];
    const pos = Position.fromSfen(game.startSfen);
    let previousTo: Square | null = null;
    for (const usi of game.moves) {
      labels.push(formatUsiMoveAsKif(pos, usi, previousTo));
      previousTo = usiToSquare(usi.slice(2, 4));
      pos.applyUsiMove(usi);
    }
    return labels;
  }, [game]);

  const positions = useMemo(() => {
    if (!game) return [];
    const list: Position[] = [];
    const pos = Position.fromSfen(game.startSfen);
    list.push(pos.clone());
    for (const usi of game.moves) {
      pos.applyUsiMove(usi);
      list.push(pos.clone());
    }
    return list;
  }, [game]);

  const runAnalysis = useCallback(async () => {
    setError(null);
    let parsed: ParsedGame;
    try {
      parsed = parseKifu(kifuText);
    } catch (e) {
      setError(`Lecture du kifu impossible : ${(e as Error).message}`);
      return;
    }
    if (parsed.moves.length === 0) {
      setError("Aucun coup n'a pu être lu dans ce kifu.");
      return;
    }
    setGame(parsed);
    setCurrentPly(0);
    setPhase({ kind: 'analyzing', done: 0, total: parsed.moves.length + 1 });

    try {
      if (!engineRef.current) engineRef.current = new UsiEngine();
      const engine = engineRef.current;
      await engine.ready;
      const res = await analyzeGame(engine, parsed.startSfen, parsed.moves, {
        movetimeMs,
        onProgress: (done, total) => setPhase({ kind: 'analyzing', done, total }),
      });
      setResult(res);
      setPhase({ kind: 'done' });
    } catch (e) {
      setError(`Analyse interrompue : ${(e as Error).message}`);
      setPhase({ kind: 'input' });
    }
  }, [kifuText, movetimeMs]);

  const shownPosition = positions[currentPly] ?? null;
  const lastMove =
    currentPly > 0 && game
      ? {
          from: game.moves[currentPly - 1].includes('*')
            ? null
            : usiToSquare(game.moves[currentPly - 1].slice(0, 2)),
          to: usiToSquare(game.moves[currentPly - 1].slice(2, 4)),
        }
      : null;

  const summary = useMemo(() => {
    if (!result) return null;
    const bySide = {
      b: { inaccuracy: 0, mistake: 0, blunder: 0 },
      w: { inaccuracy: 0, mistake: 0, blunder: 0 },
    };
    for (const p of result.plies) {
      if (p.quality === 'inaccuracy' || p.quality === 'mistake' || p.quality === 'blunder') {
        bySide[p.color][p.quality] += 1;
      }
    }
    return bySide;
  }, [result]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>将棋 — Analyseur de parties</h1>
        <p className="app-tagline">
          Collez un kifu, obtenez la courbe d'évaluation, repérez vos gaffes et rejouez-les.
        </p>
      </header>

      {envIssues.length > 0 && (
        <div className="banner banner-warn">
          {envIssues.map((msg) => (
            <p key={msg}>{msg}</p>
          ))}
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      {phase.kind !== 'done' && (
        <KifuInput
          value={kifuText}
          onChange={setKifuText}
          onAnalyze={runAnalysis}
          movetimeMs={movetimeMs}
          onMovetimeChange={setMovetimeMs}
          disabled={phase.kind === 'analyzing'}
        />
      )}

      {phase.kind === 'analyzing' && (
        <div className="progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${Math.round((phase.done / phase.total) * 100)}%` }}
            />
          </div>
          <span>
            Analyse : {phase.done} / {phase.total} positions
          </span>
        </div>
      )}

      {phase.kind === 'done' && result && game && (
        <>
          <div className="toolbar">
            <div className="tabs">
              <button
                className={`tab${tab === 'analysis' ? ' active' : ''}`}
                onClick={() => setTab('analysis')}
              >
                Analyse
              </button>
              <button
                className={`tab${tab === 'training' ? ' active' : ''}`}
                onClick={() => setTab('training')}
              >
                Entraînement ({result.blunders.length})
              </button>
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setPhase({ kind: 'input' });
                setResult(null);
                setGame(null);
              }}
            >
              Nouvelle partie
            </button>
          </div>

          {summary && (
            <div className="summary">
              {(['b', 'w'] as const).map((side) => (
                <div className="summary-card" key={side}>
                  <span className="summary-side">
                    {side === 'b' ? '▲ Sente' : '△ Gote'}
                    {side === 'b' && game.black ? ` — ${game.black}` : ''}
                    {side === 'w' && game.white ? ` — ${game.white}` : ''}
                  </span>
                  <span className="summary-stats">
                    <em style={{ color: 'var(--status-inaccuracy)' }}>
                      {summary[side].inaccuracy} {QUALITY_LABEL_FR.inaccuracy.toLowerCase()}
                    </em>
                    <em style={{ color: 'var(--status-mistake)' }}>
                      {summary[side].mistake} {QUALITY_LABEL_FR.mistake.toLowerCase()}
                    </em>
                    <em style={{ color: 'var(--status-blunder)' }}>
                      {summary[side].blunder} {QUALITY_LABEL_FR.blunder.toLowerCase()}
                    </em>
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'analysis' ? (
            <>
              <EvalGraph
                evalCurve={result.evalCurve}
                plies={result.plies}
                moveLabels={moveLabels}
                currentPly={currentPly}
                onSelectPly={setCurrentPly}
              />
              <div className="analysis-body">
                {shownPosition && <Board position={shownPosition} lastMove={lastMove} />}
                <div className="analysis-side">
                  <div className="ply-nav">
                    <button
                      className="btn btn-ghost"
                      onClick={() => setCurrentPly(0)}
                      disabled={currentPly === 0}
                    >
                      ⏮
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setCurrentPly((p) => Math.max(0, p - 1))}
                      disabled={currentPly === 0}
                    >
                      ‹
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setCurrentPly((p) => Math.min(game.moves.length, p + 1))}
                      disabled={currentPly >= game.moves.length}
                    >
                      ›
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setCurrentPly(game.moves.length)}
                      disabled={currentPly >= game.moves.length}
                    >
                      ⏭
                    </button>
                  </div>
                  <MoveList
                    plies={result.plies}
                    moveLabels={moveLabels}
                    currentPly={currentPly}
                    onSelectPly={setCurrentPly}
                  />
                </div>
              </div>
            </>
          ) : (
            <TrainingMode
              blunders={result.blunders}
              engine={engineRef.current}
              movetimeMs={movetimeMs}
            />
          )}
        </>
      )}

      <footer className="app-footer">
        <span>
          Moteur : YaneuraOu compilé en WebAssembly — tout tourne dans votre navigateur, rien n'est
          envoyé sur un serveur.
        </span>
      </footer>
    </div>
  );
}
