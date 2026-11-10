// One unit's "guidebook": every sign with its reference clip (learn by watching), mastery status,
// and a button to practise the unit in order, starting at the first sign not yet mastered
// (IR FR5: set-sequence mode; picking any card = one-at-a-time mode).
import { useSkipAhead } from "../components/SkipDialog.jsx";
import { ProgressBar, SignVideo } from "../components/ui.jsx";
import { isUnitUnlocked, nextSignIndex, unitStatus } from "../lib/progress.js";
import { UNIT_COLORS } from "./Home.jsx";

export default function UnitPage({ vocab, unitIndex, progress }) {
  const unit = vocab.units[unitIndex];
  const { records, unlockAll, skipped } = progress;
  const skipper = useSkipAhead(vocab, progress);
  const color = UNIT_COLORS[unitIndex % UNIT_COLORS.length];
  if (!isUnitUnlocked(vocab.units, unitIndex, records, unlockAll, skipped)) {
    return (
      <section className="empty-state">
        <span className="empty-emoji" aria-hidden="true">🔒</span>
        <h2>{unit.title} is locked</h2>
        <p>Master every sign in Unit {unitIndex} first, or skip ahead if you already know some signs.</p>
        <a className="button primary" href="#/">Back to the path</a>
        <button type="button" className="button" onClick={() => skipper.askUnit(unitIndex)}>⏭️ Skip ahead to this unit</button>
        {skipper.dialog}
      </section>
    );
  }
  const status = unitStatus(unit, records);

  return (
    <section style={{ "--unit": color }}>
      <header className="unit-hero">
        <span className="unit-number">Unit {unitIndex + 1}</span>
        <h1>{unit.title}</h1>
        <ProgressBar value={status.mastered} total={status.total} label={`${status.mastered} of ${status.total} signs mastered`} />
        <a className="button primary on-color" href={`#/practice/${unitIndex}/${nextSignIndex(unit, records)}`}>
          {status.mastered === 0 ? "Start lesson" : status.complete ? "Practise again" : "Continue lesson"}
        </a>
      </header>

      <h2 className="section-title">Signs in this unit</h2>
      <p className="muted">Watch each one, then tap it to practise.</p>
      <ul className="sign-grid">
        {unit.signs.map((sign, i) => {
          const r = records[sign.id];
          return (
            <li key={sign.id}>
              <a className={`sign-card ${r?.mastered ? "is-mastered" : ""}`} href={`#/practice/${unitIndex}/${i}`}>
                <SignVideo signId={sign.id} />
                <span className="sign-name">{sign.label}</span>
                <span className="sign-status">
                  {r?.mastered ? <span className="badge mastered">★ Mastered</span>
                    : r ? `${r.correct} of ${r.attempts} correct` : "New"}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <p className="credit">Clips: PopSign ASL v1.0 (Georgia Tech / DPAN), CC BY 4.0</p>
    </section>
  );
}
