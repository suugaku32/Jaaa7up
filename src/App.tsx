import { useCallback, useMemo, useRef, useState } from 'react';
import { Board } from './components/Board';
import type { BoardArrow } from './components/Board';
import { EvalGraph } from './components/EvalGraph';
import { KifuInput } from './components/KifuInput';
import { MoveList } from './components/MoveList';
import { TrainingMode } from './components/TrainingMode';
import { VariationBar } from './components/VariationBar';
import { UsiEngine, engineEnvironment } from './engine/UsiEngine';
import { analyzeGame } from './analysis/analyze';
import type { AnalysisPhase, AnalysisResult } from './analysis/analyze';
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
  | { kind: 'analyzing'; step: AnalysisPhase; done: number; total: number }
  | { kind: 'done' };

const PHASE_LABEL: Record<AnalysisPhase, string> = {
  scan: 'Balayage de la partie',
  refine: 'Étude des coups suspects',
};

export default function App() {
  const [kifuText, setKifuText] = useState('');
  const [movetimeMs, setMovetimeMs] = useState(200);
  const [deepMovetimeMs, setDeepMovetimeMs] = useState(2000);
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [game, setGame] = useState<ParsedGame | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [currentPly, setCurrentPly] = useState(0);
  const [tab, setTab] = useState<Tab>('analysis');
  const [flipped, setFlipped] = useState(false);
  const [showBestArrow, setShowBestArrow] = useState(true);
  const [focusSide, setFocusSide] = useState<'both' | 'b' | 'w'>('both');
  /** Variante rejouée par-dessus la partie : d'où elle part, ses coups, et où on en est. */
  const [variation, setVariation] = useState<{
    baseSfen: string;
    moves: string[];
    index: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<UsiEngine | null>(null);

  const env = useMemo(() => engineEnvironment(), []);

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
    setPhase({ kind: 'analyzing', step: 'scan', done: 0, total: parsed.moves.length + 1 });

    try {
      if (!engineRef.current) engineRef.current = new UsiEngine();
      const engine = engineRef.current;
      await engine.ready;
      const res = await analyzeGame(engine, parsed.startSfen, parsed.moves, {
        movetimeMs,
        deepMovetimeMs,
        onProgress: (step, done, total) => setPhase({ kind: 'analyzing', step, done, total }),
      });
      setResult(res);
      setPhase({ kind: 'done' });
    } catch (e) {
      setError(`Analyse interrompue : ${(e as Error).message}`);
      setPhase({ kind: 'input' });
    }
  }, [kifuText, movetimeMs, deepMovetimeMs]);

  // Quand une variante est en cours, c'est elle qu'on montre : le plateau rejoue
  // la ligne du moteur au lieu de la partie.
  const variationView = useMemo(() => {
    if (!variation) return null;
    try {
      const pos = Position.fromSfen(variation.baseSfen);
      let last: { from: Square | null; to: Square } | null = null;
      for (const usi of variation.moves.slice(0, variation.index)) {
        last = {
          from: usi.includes('*') ? null : usiToSquare(usi.slice(0, 2)),
          to: usiToSquare(usi.slice(2, 4)),
        };
        pos.applyUsiMove(usi);
      }
      const next = variation.moves[variation.index] ?? null;
      return { position: pos, lastMove: last, next };
    } catch {
      return null;
    }
  }, [variation]);

  const shownPosition = variationView ? variationView.position : (positions[currentPly] ?? null);

  const gameLastMove =
    currentPly > 0 && game
      ? {
          from: game.moves[currentPly - 1].includes('*')
            ? null
            : usiToSquare(game.moves[currentPly - 1].slice(0, 2)),
          to: usiToSquare(game.moves[currentPly - 1].slice(2, 4)),
        }
      : null;
  const lastMove = variationView ? variationView.lastMove : gameLastMove;

  const toArrow = (usi: string, kind: BoardArrow['kind']): BoardArrow => ({
    from: usi[1] === '*' ? null : usiToSquare(usi.slice(0, 2)),
    to: usiToSquare(usi.slice(2, 4)),
    kind,
  });

  // Dans une variante on annonce le coup suivant de la ligne ; sinon le meilleur
  // coup depuis la position affichée — plies[i] a pour sfenBefore sfens[i], donc
  // plies[currentPly] part bien de ce qu'on voit.
  const arrows = useMemo<BoardArrow[]>(() => {
    if (!showBestArrow) return [];
    if (variationView) return variationView.next ? [toArrow(variationView.next, 'best')] : [];
    const best = result?.plies[currentPly]?.bestMove;
    return best ? [toArrow(best, 'best')] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, currentPly, showBestArrow, variationView]);

  const currentPlyEval = result?.plies[currentPly - 1] ?? null;

  const selectPly = useCallback((ply: number) => {
    setCurrentPly(ply);
    setVariation(null);
  }, []);

  // « Suivre un joueur » : on ne montre que ses fautes, sans réanalyser la partie.
  const focusedPlies = useMemo(
    () => (result ? result.plies.filter((p) => focusSide === 'both' || p.color === focusSide) : []),
    [result, focusSide],
  );
  const focusedBlunders = useMemo(
    () => focusedPlies.filter((p) => p.quality === 'blunder'),
    [focusedPlies],
  );

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

      {env.messages.length > 0 && (
        <div className={`banner ${env.blocking ? 'banner-error' : 'banner-warn'}`}>
          {env.messages.map((msg) => (
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
          deepMovetimeMs={deepMovetimeMs}
          onDeepMovetimeChange={setDeepMovetimeMs}
          disabled={phase.kind === 'analyzing' || env.blocking}
        />
      )}

      {phase.kind === 'analyzing' && (
        <div className="progress">
          <div className="progress-bar">
            <div
              className={`progress-fill${phase.step === 'refine' ? ' refine' : ''}`}
              style={{ width: `${Math.round((phase.done / phase.total) * 100)}%` }}
            />
          </div>
          <span>
            {PHASE_LABEL[phase.step]} — {phase.done} / {phase.total} positions
            {phase.step === 'scan' && deepMovetimeMs > 0 && ' (passe 1 sur 2)'}
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
                Entraînement ({focusedBlunders.length})
              </button>
            </div>
            <div className="toolbar-actions">
              <label className="focus-control">
                Suivre :
                <select
                  value={focusSide}
                  onChange={(e) => setFocusSide(e.target.value as 'both' | 'b' | 'w')}
                >
                  <option value="both">Les deux joueurs</option>
                  <option value="b">▲ {game.black || 'Sente'}</option>
                  <option value="w">△ {game.white || 'Gote'}</option>
                </select>
              </label>
              <button
                className="btn btn-ghost"
                onClick={() => setFlipped((f) => !f)}
                title="Voir le plateau depuis l'autre camp"
              >
                ⇅ {flipped ? 'Vue Gote' : 'Vue Sente'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setShowBestArrow((v) => !v)}
                title="Flèche verte : le coup recommandé depuis la position affichée"
              >
                {showBestArrow ? '↗ Flèches' : '↗ Sans flèches'}
              </button>
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
                plies={focusedPlies}
                moveLabels={moveLabels}
                currentPly={currentPly}
                onSelectPly={selectPly}
              />
              <div className="analysis-body">
                <div className="analysis-board">
                  {shownPosition && (
                    <Board
                      position={shownPosition}
                      lastMove={lastMove}
                      flipped={flipped}
                      arrows={arrows}
                      blackName={game.black}
                      whiteName={game.white}
                    />
                  )}
                  {variation && (
                    <p className="variation-hint">
                      Variante du moteur — le plateau ne suit plus la partie.
                    </p>
                  )}
                </div>
                <div className="analysis-side">
                  <div className="ply-nav">
                    <button
                      className="btn btn-ghost"
                      onClick={() => selectPly(0)}
                      disabled={currentPly === 0}
                    >
                      ⏮
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => selectPly(Math.max(0, currentPly - 1))}
                      disabled={currentPly === 0}
                    >
                      ‹
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => selectPly(Math.min(game.moves.length, currentPly + 1))}
                      disabled={currentPly >= game.moves.length}
                    >
                      ›
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => selectPly(game.moves.length)}
                      disabled={currentPly >= game.moves.length}
                    >
                      ⏭
                    </button>
                  </div>

                  {currentPlyEval && (
                    <div className="variations">
                      <VariationBar
                        label="Suite jouée"
                        tone="played"
                        baseSfen={currentPlyEval.sfenAfter}
                        moves={currentPlyEval.refutationPv}
                        activeIndex={
                          variation?.baseSfen === currentPlyEval.sfenAfter ? variation.index : null
                        }
                        onSelect={(i) =>
                          setVariation(
                            i === null
                              ? null
                              : {
                                  baseSfen: currentPlyEval.sfenAfter,
                                  moves: currentPlyEval.refutationPv,
                                  index: i,
                                },
                          )
                        }
                      />
                      <VariationBar
                        label="Meilleure suite"
                        tone="best"
                        baseSfen={currentPlyEval.sfenBefore}
                        moves={currentPlyEval.bestMovePv}
                        activeIndex={
                          variation?.baseSfen === currentPlyEval.sfenBefore ? variation.index : null
                        }
                        onSelect={(i) =>
                          setVariation(
                            i === null
                              ? null
                              : {
                                  baseSfen: currentPlyEval.sfenBefore,
                                  moves: currentPlyEval.bestMovePv,
                                  index: i,
                                },
                          )
                        }
                      />
                    </div>
                  )}

                  <MoveList
                    plies={result.plies}
                    moveLabels={moveLabels}
                    currentPly={currentPly}
                    onSelectPly={selectPly}
                    focusSide={focusSide}
                  />
                </div>
              </div>
            </>
          ) : (
            <TrainingMode
              blunders={focusedBlunders}
              engine={engineRef.current}
              movetimeMs={deepMovetimeMs > 0 ? deepMovetimeMs : movetimeMs}
              flipped={flipped}
              blackName={game.black}
              whiteName={game.white}
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
