import { isCsaLike, isKifLike, parseCsa, parseKif } from './kif';
import { HIRATE_SFEN } from './position';

export type KifuFormat = 'kif' | 'csa' | 'usi';

export interface ParsedGame {
  format: KifuFormat;
  startSfen: string;
  moves: string[]; // USI coordinate moves, e.g. "7g7f", "P*5e"
  black: string;
  white: string;
}

const USI_MOVE_RE = /^[1-9][a-i][1-9][a-i]\+?$|^[A-Z]\*[1-9][a-i]$/;

function parseUsiText(text: string): ParsedGame {
  let rest = text.trim();
  let startSfen = HIRATE_SFEN;

  const sfenMatch = rest.match(/sfen\s+([^\n]+?)(?:\s+moves\s+|$)/i);
  if (sfenMatch) {
    startSfen = sfenMatch[1].trim();
  }
  const movesMatch = rest.match(/moves\s+(.+)$/is);
  if (movesMatch) {
    rest = movesMatch[1];
  } else {
    rest = rest.replace(/position\s+startpos/i, '').replace(/position\s+sfen[^]*?(?=moves|$)/i, '');
  }

  const tokens = rest.split(/\s+/).filter(Boolean).filter((t) => t.toLowerCase() !== 'startpos');
  const moves = tokens.filter((t) => USI_MOVE_RE.test(t));

  return { format: 'usi', startSfen, moves, black: '', white: '' };
}

export function parseKifu(text: string): ParsedGame {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Le kifu est vide.');
  }
  if (isCsaLike(trimmed)) {
    return parseCsa(trimmed);
  }
  if (isKifLike(trimmed)) {
    return parseKif(trimmed);
  }
  return parseUsiText(trimmed);
}
