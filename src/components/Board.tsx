import type { Position } from '../shogi/position';
import { pieceGlyph } from '../shogi/notation';
import type { Color, PieceType, Square } from '../shogi/types';
import { HAND_PIECE_ORDER, sameSquare } from '../shogi/types';
import './Board.css';

export interface BoardProps {
  position: Position;
  lastMove?: { from: Square | null; to: Square } | null;
  interactive?: boolean;
  selected?: { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null;
  legalDestinations?: Square[];
  errorSquare?: Square | null;
  /** Which side's hand accepts clicks when interactive. */
  handSide?: Color;
  /** Gote at the bottom instead of Sente — pieces and hands turn with the board. */
  flipped?: boolean;
  blackName?: string;
  whiteName?: string;
  onSquareClick?: (sq: Square) => void;
  onHandPieceClick?: (type: PieceType) => void;
  cellSize?: number;
}

export function Board({
  position,
  lastMove,
  interactive,
  selected,
  legalDestinations,
  errorSquare,
  handSide = 'b',
  flipped = false,
  blackName,
  whiteName,
  onSquareClick,
  onHandPieceClick,
  cellSize = 40,
}: BoardProps) {
  const isLegalDest = (sq: Square) => (legalDestinations ?? []).some((d) => sameSquare(d, sq));

  // Unflipped the board reads rank 1→9 downwards and file 9→1 rightwards; flipping
  // reverses both axes, which is exactly a 180° turn.
  const ranks = flipped ? [9, 8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const files = flipped ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [9, 8, 7, 6, 5, 4, 3, 2, 1];

  const rows = ranks.map((rank) => (
    <div className="board-row" key={rank}>
      {files.map((file) => {
        const sq = { file, rank };
        const piece = position.pieceAt(sq);
        const classes = ['cell'];
        if (lastMove && sameSquare(lastMove.to, sq)) classes.push('ht');
        if (lastMove?.from && sameSquare(lastMove.from, sq)) classes.push('hf');
        if (selected?.kind === 'square' && sameSquare(selected.sq, sq)) classes.push('sel');
        if (errorSquare && sameSquare(errorSquare, sq)) classes.push('err');
        if (isLegalDest(sq)) classes.push('hint');
        // A piece faces away from whoever sits at the bottom of the board.
        const upsideDown = piece ? (piece.color === 'w') !== flipped : false;
        return (
          <div
            key={file}
            className={classes.join(' ')}
            style={{ width: cellSize, height: cellSize }}
            onClick={() => interactive && onSquareClick?.(sq)}
            role={interactive ? 'button' : undefined}
            aria-label={`${file}${rank}`}
          >
            {piece && (
              <span
                className={`pc${piece.promoted ? ' promoted' : ''}${upsideDown ? ' gote' : ''}`}
                style={{ fontSize: Math.round(cellSize * 0.72) }}
              >
                {pieceGlyph(piece.type, piece.promoted)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  ));

  const top: Color = flipped ? 'b' : 'w';
  const bottom: Color = flipped ? 'w' : 'b';
  const nameOf = (c: Color) => (c === 'b' ? blackName : whiteName);

  return (
    <div className="board-wrap">
      <HandRow
        color={top}
        name={nameOf(top)}
        hand={position.hands[top]}
        upsideDown
        interactive={interactive && handSide === top}
        selectedType={selected?.kind === 'hand' && handSide === top ? selected.type : null}
        onClick={onHandPieceClick}
      />
      <div className="goban" style={{ width: cellSize * 9 }}>
        {rows}
      </div>
      <HandRow
        color={bottom}
        name={nameOf(bottom)}
        hand={position.hands[bottom]}
        upsideDown={false}
        interactive={interactive && handSide === bottom}
        selectedType={selected?.kind === 'hand' && handSide === bottom ? selected.type : null}
        onClick={onHandPieceClick}
      />
    </div>
  );
}

function HandRow({
  color,
  name,
  hand,
  upsideDown,
  interactive,
  selectedType,
  onClick,
}: {
  color: Color;
  name?: string;
  hand: Record<Exclude<PieceType, 'K'>, number>;
  upsideDown?: boolean;
  interactive?: boolean;
  selectedType?: PieceType | null;
  onClick?: (type: PieceType) => void;
}) {
  const pieces = HAND_PIECE_ORDER.filter((t) => hand[t] > 0);
  return (
    <div className="hbox">
      <span className="hl">
        <span className="hl-side">{color === 'b' ? '▲ Sente' : '△ Gote'}</span>
        {name && <span className="hl-name">{name}</span>}
      </span>
      <div className="hpieces">
        {pieces.length === 0 && <span className="hempty">—</span>}
        {pieces.map((type) => (
          <div
            key={type}
            className={`hp${selectedType === type ? ' sel' : ''}${interactive ? ' clickable' : ''}`}
            onClick={() => interactive && onClick?.(type)}
            role={interactive ? 'button' : undefined}
          >
            <span className={`pc${upsideDown ? ' gote' : ''}`} style={{ fontSize: 20 }}>
              {pieceGlyph(type, false)}
            </span>
            {hand[type] > 1 && <span className="hpc">{hand[type]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
