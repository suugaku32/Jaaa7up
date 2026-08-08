import { useMemo, useState } from 'react';
import { parseKifu } from '../shogi/parser';
import { MovetimeSlider } from './MovetimeSlider';
import './KifuInput.css';

const EXAMPLE_KIF = `手合割：平手
先手：Sente
後手：Gote
   1 ７六歩(77)
   2 ３四歩(33)
   3 ２六歩(27)
   4 ８四歩(83)
   5 ２五歩(26)
   6 ８五歩(84)
   7 ７八金(69)
   8 ３二金(41)
`;

interface KifuInputProps {
  value: string;
  onChange: (text: string) => void;
  onAnalyze: () => void;
  movetimeMs: number;
  onMovetimeChange: (ms: number) => void;
  disabled?: boolean;
}

export function KifuInput({
  value,
  onChange,
  onAnalyze,
  movetimeMs,
  onMovetimeChange,
  disabled,
}: KifuInputProps) {
  const [showHelp, setShowHelp] = useState(false);

  /*
   * Combien de temps ça va prendre. La question se pose depuis que le balayage
   * monte à 2 s : sur une partie de 120 coups, c'est quatre minutes d'attente
   * qu'on peut lancer sans le savoir. Le calcul est exact — une recherche par
   * position, positions = coups + 1 — donc autant l'annoncer.
   *
   * Le kifu est relu à chaque frappe. C'est sans conséquence : quelques
   * centaines de coups s'analysent en une fraction de milliseconde, et le
   * résultat n'est de toute façon utilisé que pour ce chiffre.
   */
  const positions = useMemo(() => {
    try {
      return parseKifu(value).moves.length + 1;
    } catch {
      return null;
    }
  }, [value]);

  return (
    <div className="kifu-input">
      <textarea
        className="kifu-textarea"
        placeholder="Collez ici un kifu au format KIF, KI2, CSA ou une liste de coups USI (position startpos moves ...)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        disabled={disabled}
      />
      <div className="kifu-controls">
        <button type="button" className="btn btn-primary" onClick={onAnalyze} disabled={disabled || !value.trim()}>
          Analyser la partie
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onChange(EXAMPLE_KIF)} disabled={disabled}>
          Charger un exemple
        </button>
        <MovetimeSlider
          label="Balayage"
          value={movetimeMs}
          onChange={onMovetimeChange}
          positions={positions}
          disabled={disabled}
        />
        <button type="button" className="btn btn-link" onClick={() => setShowHelp((v) => !v)}>
          {showHelp ? 'Masquer les formats' : 'Formats acceptés ?'}
        </button>
      </div>
      {showHelp && (
        <div className="kifu-help">
          <p><strong>KIF</strong> : format numéroté japonais, ex. <code>1 ７六歩(77)</code>.</p>
          <p><strong>KI2</strong> : format avec ▲/△, ex. <code>▲７六歩 △３四歩</code> (désambiguïsation automatique la plupart du temps).</p>
          <p><strong>CSA</strong> : lignes <code>+7776FU</code> / <code>-3334FU</code>.</p>
          <p><strong>USI</strong> : <code>position startpos moves 7g7f 3c3d ...</code> ou une simple liste de coups.</p>
          <p className="kifu-help-note">
            L'analyse se fait en deux passes : un <strong>balayage</strong> rapide de toute la
            partie pour repérer les coups suspects, puis une <strong>étude</strong> plus longue
            de ces seules positions. C'est cette seconde passe qui fournit le meilleur coup
            servant de corrigé en mode entraînement.
          </p>
        </div>
      )}
    </div>
  );
}
