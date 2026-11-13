// One unit's "guidebook": its lessons (lib/lesson.js; stars from the best run) and the unit
// review, then every sign with its reference clip (learn by watching) and mastery status.
// The big button starts the next lesson (IR FR5: set-sequence mode); picking a sign card
// practises just that sign (one-at-a-time mode).
import { useSkipAhead } from "../components/SkipDialog.jsx";
import { ProgressBar, SignVideo } from "../components/ui.jsx";
import { bestStars, lessonsOf, unitReviewKey } from "../lib/lesson.js";
import { isUnitUnlocked, unitStatus } from "../lib/progress.js";
import { labelOf } from "../lib/vocabulary.js";
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
  const lessons = lessonsOf(vocab, unitIndex);
  const stars = bestStars(progress.lessons);
  const mastered = (l) => l.signs.every((id) => records[id]?.mastered);
  const nextLesson = lessons.findIndex((l) => !stars[l.key] && !mastered(l));
  const startHref = nextLesson === -1 ? `#/lesson/${unitIndex}/review` : `#/lesson/${unitIndex}/${nextLesson}`;
  const Stars = ({ n }) => <span className="node-stars" aria-label={`${n} of 3 stars`}>{"★".repeat(n)}<span className="off">{"★".repeat(3 - n)}</span></span>;

  return (
    <section style={{ "--unit": color }}>
      <header className="unit-hero">
        <span className="unit-number">Unit {unitIndex + 1}</span>
        <h1>{unit.title}</h1>
        <ProgressBar value={status.mastered} total={status.total} label={`${status.mastered} of ${status.total} signs mastered`} />
        <a className="button primary on-color" href={startHref}>
          {nextLesson === -1 ? "Unit review" : `${Object.keys(stars).some((k) => k.startsWith(`${unit.id}:`)) ? "Continue" : "Start"}: Lesson ${nextLesson + 1}`}
        </a>
      </header>

      <h2 className="section-title">Lessons</h2>
      <ol className="lesson-list">
        {lessons.map((l, i) => (
          <li key={l.key}>
            <a className={`lesson-card ${i === nextLesson ? "next" : ""}`} href={`#/lesson/${unitIndex}/${i}`}>
              <span className="lesson-card-icon" aria-hidden="true">{mastered(l) ? "★" : stars[l.key] ? "✓" : i + 1}</span>
              <span className="lesson-card-text">
                <strong>Lesson {i + 1}</strong>
                <span className="muted">{l.signs.map((id) => labelOf(vocab, id)).join(" · ")}</span>
              </span>
              {stars[l.key] ? <Stars n={stars[l.key]} /> : <span className="muted lesson-card-go">Start ›</span>}
            </a>
          </li>
        ))}
        <li>
          <a className={`lesson-card review ${nextLesson === -1 ? "next" : ""}`} href={`#/lesson/${unitIndex}/review`}>
            <span className="lesson-card-icon" aria-hidden="true">🏆</span>
            <span className="lesson-card-text">
              <strong>Unit review</strong>
              <span className="muted">Every sign of the unit, from memory, mixed</span>
            </span>
            {stars[unitReviewKey(unit)] ? <Stars n={stars[unitReviewKey(unit)]} /> : <span className="muted lesson-card-go">Start ›</span>}
          </a>
        </li>
      </ol>

      <h2 className="section-title">Signs in this unit</h2>
      <p className="muted">Watch each one, or tap it to practise just that sign.</p>
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
