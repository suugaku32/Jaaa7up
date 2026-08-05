import type { PlyEval } from '../analysis/analyze';
import { QUALITY_COLOR, QUALITY_LABEL_FR } from '../analysis/classify';
import './MoveList.css';

interface MoveListProps {
  plies: PlyEval[];
  moveLabels: string[];
  currentPly: number;
  onSelectPly: (ply: number) => void;
}

const SHOWN_QUALITIES = new Set(['inaccuracy', 'mistake', 'blunder']);

export function MoveList({ plies, moveLabels, currentPly, onSelectPly }: MoveListProps) {
  return (
    <ol className="move-list" aria-label="Liste des coups">
      <li
        className={`move-row move-row-start${currentPly === 0 ? ' active' : ''}`}
        onClick={() => onSelectPly(0)}
      >
        Position de départ
      </li>
      {plies.map((p) => (
        <li
          key={p.ply}
          className={`move-row${currentPly === p.ply ? ' active' : ''}`}
          onClick={() => onSelectPly(p.ply)}
        >
          <span className="move-num">{p.ply}.</span>
          <span className="move-side">{p.color === 'b' ? '▲' : '△'}</span>
          <span className="move-text">{moveLabels[p.ply - 1]}</span>
          <span className="move-score">{formatSigned(p.evalAfterCp, p.color)}</span>
          {SHOWN_QUALITIES.has(p.quality) && (
            <span className="move-quality" style={{ color: QUALITY_COLOR[p.quality] }}>
              {QUALITY_LABEL_FR[p.quality]}
              {p.refined && (
                <span className="move-refined" title="Réexaminé en profondeur">
                  {' '}
                  ✓
                </span>
              )}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function formatSigned(cpForMover: number, color: 'b' | 'w'): string {
  const cpForBlack = color === 'b' ? cpForMover : -cpForMover;
  const sign = cpForBlack > 0 ? '+' : '';
  return `${sign}${(cpForBlack / 100).toFixed(1)}`;
}
