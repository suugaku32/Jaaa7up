export interface EmscriptenEngineModule {
  postMessage(cmd: string): void;
  addMessageListener(cb: (line: string) => void): void;
  removeMessageListener(cb: (line: string) => void): void;
  terminate(): void;
}

declare global {
  interface Window {
    YaneuraOu?: (moduleOverrides?: Record<string, unknown>) => Promise<EmscriptenEngineModule>;
  }
}

export interface AnalyzeOptions {
  movetimeMs?: number;
  depth?: number;
}

export interface AnalyzeResult {
  bestMove: string | null;
  /** Centipawn score from the perspective of the side to move in the analyzed position. */
  scoreCp: number | null;
  /** Moves-to-mate if the engine found a forced mate (positive = side to move mates). */
  scoreMate: number | null;
  pv: string[];
}

let scriptLoadPromise: Promise<void> | null = null;

function engineBaseUrl(): string {
  return `${import.meta.env.BASE_URL}engine/`;
}

function loadEngineScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    if (window.YaneuraOu) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `${engineBaseUrl()}yaneuraou.js`;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Impossible de charger le moteur d'analyse (yaneuraou.js introuvable)."));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export interface EnvironmentReport {
  /** The engine cannot run at all in this browser as things stand. */
  blocking: boolean;
  messages: string[];
}

/**
 * The engine is compiled with pthreads, so its WebAssembly memory is shared and
 * it simply cannot instantiate without SharedArrayBuffer — which browsers only
 * expose to cross-origin-isolated pages.
 */
export function engineEnvironment(): EnvironmentReport {
  const messages: string[] = [];

  if (typeof WebAssembly === 'undefined') {
    return { blocking: true, messages: ['Ce navigateur ne supporte pas WebAssembly.'] };
  }

  const hasSab = typeof SharedArrayBuffer !== 'undefined';
  const isolated = window.crossOriginIsolated === true;
  if (hasSab && isolated) return { blocking: false, messages: [] };

  const swSupported = 'serviceWorker' in navigator;
  const swControlling = swSupported && navigator.serviceWorker.controller !== null;

  if (!window.isSecureContext) {
    messages.push(
      "La page n'est pas servie en HTTPS, ce que l'isolation cross-origin exige. Ouvrez le site en https://.",
    );
    return { blocking: true, messages };
  }

  if (!swSupported) {
    messages.push(
      "Ce navigateur n'expose pas les service workers (navigation privée ?), qui sont nécessaires ici pour activer l'isolation cross-origin.",
    );
    return { blocking: true, messages };
  }

  if (!swControlling) {
    messages.push(
      "Le service worker vient de s'installer et ne contrôle pas encore la page. Rechargez pour activer le moteur.",
    );
    return { blocking: true, messages };
  }

  // Service worker in place but still no isolation: the browser is refusing the
  // headers rather than missing them.
  messages.push(
    "Le service worker est actif mais ce navigateur n'accorde pas l'isolation cross-origin, sans laquelle le moteur ne peut pas démarrer.",
  );
  messages.push(
    "Safari sur iPhone et iPad est le cas le plus courant : essayez Chrome ou Firefox, ou un ordinateur.",
  );
  return { blocking: true, messages };
}

export class UsiEngine {
  private module: EmscriptenEngineModule | null = null;
  private listeners: Set<(line: string) => void> = new Set();
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const env = engineEnvironment();
    if (env.blocking) {
      // Fail with the diagnosis rather than letting the emscripten glue throw a
      // bare "Can't find variable: SharedArrayBuffer" at the user.
      throw new Error(env.messages.join(' '));
    }
    await loadEngineScript();
    const factory = window.YaneuraOu;
    if (!factory) {
      throw new Error("Le moteur d'analyse n'a pas pu s'initialiser (YaneuraOu introuvable).");
    }
    this.module = await factory({
      locateFile: (path: string) => `${engineBaseUrl()}${path}`,
    });
    this.module.addMessageListener((line) => {
      for (const cb of this.listeners) cb(line);
    });
    this.postRaw('usi');
    await this.waitFor((line) => line === 'usiok');
    this.postRaw('isready');
    await this.waitFor((line) => line === 'readyok');
    this.postRaw('usinewgame');
  }

  private addListener(cb: (line: string) => void): void {
    this.listeners.add(cb);
  }

  private removeListener(cb: (line: string) => void): void {
    this.listeners.delete(cb);
  }

  private postRaw(cmd: string): void {
    if (!this.module) throw new Error('Moteur non initialisé.');
    this.module.postMessage(cmd);
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs = 20000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener(onLine);
        reject(new Error("Le moteur d'analyse ne répond pas (délai dépassé)."));
      }, timeoutMs);
      const onLine = (line: string) => {
        if (predicate(line)) {
          clearTimeout(timer);
          this.removeListener(onLine);
          resolve(line);
        }
      };
      this.addListener(onLine);
    });
  }

  async analyze(sfen: string, moves: string[], opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    await this.ready;
    const posCmd = moves.length
      ? `position sfen ${sfen} moves ${moves.join(' ')}`
      : `position sfen ${sfen}`;
    this.postRaw(posCmd);

    let scoreCp: number | null = null;
    let scoreMate: number | null = null;
    let pv: string[] = [];
    const onInfo = (line: string) => {
      if (!line.startsWith('info')) return;
      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      const pvMatch = line.match(/ pv (.+)$/);
      if (cpMatch) {
        scoreCp = parseInt(cpMatch[1], 10);
        scoreMate = null;
      }
      if (mateMatch) {
        scoreMate = parseInt(mateMatch[1], 10);
        scoreCp = null;
      }
      if (pvMatch) pv = pvMatch[1].trim().split(/\s+/);
    };
    this.addListener(onInfo);

    const movetime = opts.movetimeMs ?? 500;
    const goCmd = opts.depth ? `go depth ${opts.depth}` : `go movetime ${movetime}`;
    this.postRaw(goCmd);

    let bestmoveLine: string;
    try {
      bestmoveLine = await this.waitFor((line) => line.startsWith('bestmove'), movetime + 20000);
    } finally {
      this.removeListener(onInfo);
    }
    const bestMoveToken = bestmoveLine.split(/\s+/)[1] ?? null;
    const bestMove = bestMoveToken === 'resign' || bestMoveToken === 'win' ? null : bestMoveToken;
    return { bestMove, scoreCp, scoreMate, pv };
  }

  terminate(): void {
    this.module?.terminate();
    this.module = null;
  }
}
