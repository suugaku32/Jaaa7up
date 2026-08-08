import { Position } from '../shogi/position';
import { formatUsiMoveAsKif, pieceKanji } from '../shogi/notation';
import type { Color, PieceType } from '../shogi/types';
import { usiToSquare, sameSquare } from '../shogi/types';

/**
 * De quoi comprendre pourquoi un coup est mauvais.
 *
 * Rien n'est inventé ici : un moteur ne rend pas de commentaire, il rend une
 * variante et un score. Tout ce qui suit se calcule en rejouant cette variante
 * — qui prend quoi, à quel coup, et où va l'évaluation. Le but est de nommer ce
 * qu'on ne voit pas toujours en lisant huit coups en notation, pas de tenir un
 * discours d'entraîneur que rien n'étaierait.
 */
export interface MistakeExplanation {
  /** Une observation par phrase, la plus parlante d'abord. */
  points: string[];
}

const PIECE_ORDER: PieceType[] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

/** « 銀 ×2, 歩 » — le butin d'un camp, du plus lourd au plus léger. */
function listPieces(counts: Map<PieceType, number>): string {
  return PIECE_ORDER.filter((t) => counts.get(t))
    .map((t) => {
      const n = counts.get(t)!;
      return n > 1 ? `${pieceKanji(t, false)} ×${n}` : pieceKanji(t, false);
    })
    .join(', ');
}

export function explainMistake(opts: {
  /** Position après le coup joué : c'est de là que part la réfutation. */
  sfenAfter: string;
  playedUsi: string;
  refutationPv: string[];
  /** Scores du point de vue de celui qui a joué. */
  evalBeforeCp: number;
  evalAfterCp: number;
  /** `score mate` après le coup, ramené au point de vue du joueur. */
  mateAfter: number | null;
  mover: Color;
}): MistakeExplanation {
  const { sfenAfter, playedUsi, refutationPv, evalBeforeCp, evalAfterCp, mateAfter, mover } = opts;
  const points: string[] = [];

  // Le plus grave d'abord : un mat annoncé rend le reste anecdotique.
  if (mateAfter !== null && mateAfter < 0) {
    points.push(`Ce coup laisse un mat forcé : l’adversaire mate en ${-mateAfter}.`);
  }

  const to = usiToSquare(playedUsi.slice(2, 4));
  const pris = new Map<PieceType, number>();
  const perdu = new Map<PieceType, number>();
  let repriseImmediate: string | null = null;

  try {
    const pos = Position.fromSfen(sfenAfter);
    for (let i = 0; i < refutationPv.length; i++) {
      const usi = refutationPv[i];
      const auTrait = pos.turn;
      const label = formatUsiMoveAsKif(pos, usi, i === 0 ? to : null);
      const cible = usiToSquare(usi.slice(2, 4));
      const { capture } = pos.applyUsiMove(usi);
      if (!capture) continue;
      // `auTrait` est celui qui vient de prendre : de notre point de vue, ce
      // qu'il gagne est ce que nous perdons.
      const bourse = auTrait === mover ? pris : perdu;
      bourse.set(capture, (bourse.get(capture) ?? 0) + 1);
      // Reprise sur la case même où l'on vient de jouer, dès le coup suivant :
      // c'est la faute la plus fréquente et la plus facile à ne pas voir.
      if (i === 0 && auTrait !== mover && sameSquare(cible, to)) repriseImmediate = label;
    }
  } catch {
    // Variante invalide : on se contente de ce qui a pu être établi.
  }

  if (repriseImmediate) {
    points.push(`La pièce que vous venez de jouer est reprise aussitôt : ${repriseImmediate}.`);
  }

  const butin = listPieces(perdu);
  const contre = listPieces(pris);
  if (butin) {
    points.push(
      contre
        ? `Dans la suite prévue, l’adversaire prend ${butin} et vous reprenez ${contre}.`
        : `Dans la suite prévue, l’adversaire prend ${butin} sans contrepartie.`,
    );
  } else if (contre) {
    points.push(`Vous gagnez ${contre} dans la suite, mais la position se dégrade quand même.`);
  }

  const perte = Math.round(evalBeforeCp - evalAfterCp);
  if (perte > 0) {
    points.push(
      `L’évaluation passe de ${Math.round(evalBeforeCp)} à ${Math.round(evalAfterCp)}, ` +
        `soit ${perte} centièmes de pion perdus.`,
    );
  }

  if (points.length === 0) {
    points.push(
      'Le moteur ne trouve pas de gain matériel immédiat : le coup perd par la position, ' +
        'pas par une prise. Déroulez la suite pour voir ce qu’elle donne.',
    );
  }

  return { points };
}
