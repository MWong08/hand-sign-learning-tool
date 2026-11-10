// Full-screen celebration when a sign is mastered or a unit is completed, with CSS confetti.
import { XP } from "../lib/gamify.js";

const CONFETTI_COLORS = ["#22a35a", "#1d8fe0", "#f59f00", "#d6336c", "#9b51e0"];

export default function Celebration({ kind, sign, unitIndex, vocab, onClose, onNext }) {
  const nextUnit = vocab.units[unitIndex + 1];
  return (
    <div className="celebrate-backdrop" role="dialog" aria-modal="true" aria-labelledby="celebrate-title">
      <div className="confetti" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 37) % 100}%`, background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${(i % 7) * 0.12}s`, animationDuration: `${1.6 + (i % 5) * 0.25}s` }} />
        ))}
      </div>
      <div className="celebrate-card">
        <div className="celebrate-emoji" aria-hidden="true">{kind === "unit" ? "🏆" : "⭐"}</div>
        <h2 id="celebrate-title">{kind === "unit" ? "Unit complete!" : `You mastered “${sign}”!`}</h2>
        <p className="xp-gain big">+{XP.mastered} XP</p>
        <p className="muted">
          {kind === "unit"
            ? nextUnit ? <>“{nextUnit.title}” is now unlocked.</> : "You've finished the whole curriculum!"
            : "Two correct in a row. On to the next one!"}
        </p>
        <div className="celebrate-actions">
          {kind === "unit" && nextUnit
            ? <a className="button primary" href={`#/unit/${unitIndex + 1}`}>Start Unit {unitIndex + 2}</a>
            : <button type="button" className="button primary" onClick={() => { onClose(); onNext(); }}>Continue</button>}
          <button type="button" className="button" onClick={onClose}>Keep practising</button>
        </div>
      </div>
    </div>
  );
}
