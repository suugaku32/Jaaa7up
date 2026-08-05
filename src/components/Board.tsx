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
  /** Which side's hand accepts clicks when interactive. Board layout is fixed: Gote on top, Sente below. */
  handSide?: Color;
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
  onSquareClick,
  onHandPieceClick,
  cellSize = 40,
}: BoardProps) {
  const isLegalDest = (sq: Square) => (legalDestinations ?? []).some((d) => sameSquare(d, sq));

  const rows = [];
  for (let rank = 1; rank <= 9; rank++) {
    const cells = [];
    for (let col = 0; col < 9; col++) {
      const file = 9 - col;
      const sq = { file, rank };
      const piece = position.pieceAt(sq);
      const classes = ['cell'];
      if (lastMove && sameSquare(lastMove.to, sq)) classes.push('ht');
      if (lastMove?.from && sameSquare(lastMove.from, sq)) classes.push('hf');
      if (selected?.kind === 'square' && sameSquare(selected.sq, sq)) classes.push('sel');
      if (errorSquare && sameSquare(errorSquare, sq)) classes.push('err');
      if (isLegalDest(sq)) classes.push('hint');
      cells.push(
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
              className={`pc${piece.promoted ? ' promoted' : ''}${piece.color === 'w' ? ' gote' : ''}`}
              style={{ fontSize: Math.round(cellSize * 0.72) }}
            >
              {pieceGlyph(piece.type, piece.promoted)}
            </span>
          )}
        </div>,
      );
    }
    rows.push(
      <div className="board-row" key={rank}>
        {cells}
      </div>,
    );
  }

  return (
    <div className="board-wrap">
      <HandRow
        color="w"
        hand={position.hands.w}
        interactive={interactive && handSide === 'w'}
        selectedType={selected?.kind === 'hand' && handSide === 'w' ? selected.type : null}
        onClick={onHandPieceClick}
      />
      <div className="goban" style={{ width: cellSize * 9 }}>
        {rows}
      </div>
      <HandRow
        color="b"
        hand={position.hands.b}
        interactive={interactive && handSide === 'b'}
        selectedType={selected?.kind === 'hand' && handSide === 'b' ? selected.type : null}
        onClick={onHandPieceClick}
      />
    </div>
  );
}

function HandRow({
  color,
  hand,
  interactive,
  selectedType,
  onClick,
}: {
  color: Color;
  hand: Record<Exclude<PieceType, 'K'>, number>;
  interactive?: boolean;
  selectedType?: PieceType | null;
  onClick?: (type: PieceType) => void;
}) {
  const pieces = HAND_PIECE_ORDER.filter((t) => hand[t] > 0);
  return (
    <div className="hbox">
      <span className="hl">{color === 'b' ? '▲ Sente' : '△ Gote'}</span>
      <div className="hpieces">
        {pieces.length === 0 && <span className="hempty">—</span>}
        {pieces.map((type) => (
          <div
            key={type}
            className={`hp${selectedType === type ? ' sel' : ''}${interactive ? ' clickable' : ''}`}
            onClick={() => interactive && onClick?.(type)}
            role={interactive ? 'button' : undefined}
          >
            <span className={`pc${color === 'w' ? ' gote' : ''}`} style={{ fontSize: 20 }}>
              {pieceGlyph(type, false)}
            </span>
            {hand[type] > 1 && <span className="hpc">{hand[type]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
