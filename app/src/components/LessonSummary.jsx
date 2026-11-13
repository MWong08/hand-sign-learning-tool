// End-of-lesson review (supervisor meeting 2): stars, XP, combo and time; any new badges; then
// every sign of the lesson with how each exercise went, its best closeness, the main thing to fix,
// and a side-by-side replay of the demo clip next to the learner's own attempt; signs that need
// more work lead to the weak-sign review.
import { useEffect, useRef, useState } from "react";
import { badgeList, badgeStats, newBadges } from "../lib/badges.js";
import { describeIssue, fixesFor } from "../lib/diagnose.js";
import { lessonsOf, summariseLesson } from "../lib/lesson.js";
import { labelOf } from "../lib/vocabulary.js";
import SideBySide from "./SideBySide.jsx";
import { useTemplates } from "../hooks/useTemplates.js";

const MARK = { correct: "✓", close: "≈", incorrect: "✗", unclear: "?", skipped: "–", none: "–" };
const TYPE = { watch: "Copy", recall: "From memory", "pick-word": "Recognise", "pick-video": "Find the video" };

export default function LessonSummary({ vocab, progress, plan, target, queue, entries, bestCombo, seconds, badgesBefore }) {
  const [summary] = useState(() => summariseLesson(queue, entries));
  const [open, setOpen] = useState(null); // sign whose replay is shown
  const templatesRef = useTemplates();
  const saved = useRef(false);

  useEffect(() => {
    if (saved.current) return;
    saved.current = true;
    progress.completeLesson({ key: plan.key, stars: summary.stars, perfect: summary.perfect, accuracy: Math.round(summary.share * 100) });
  }, [plan.key, progress, summary]);

  const earned = newBadges(badgesBefore, badgeList(badgeStats(vocab, progress.attempts, progress.records, progress.lessons, progress.game)));
  const mins = Math.floor(seconds / 60);
  const secs = String(Math.round(seconds % 60)).padStart(2, "0");

  // where to go next
  let nextHref = null;
  let nextLabel = null;
  if (target.kind === "lesson") {
    const count = lessonsOf(vocab, target.unitIndex).length;
    nextHref = target.lessonIndex + 1 < count ? `#/lesson/${target.unitIndex}/${target.lessonIndex + 1}` : `#/lesson/${target.unitIndex}/review`;
    nextLabel = target.lessonIndex + 1 < count ? "Next lesson" : "Unit review";
  }

  return (
    <section className="lesson-summary">
      <div className="summary-hero">
        <span className="celebrate-emoji" aria-hidden="true">{summary.perfect ? "🏆" : summary.stars >= 2 ? "🎉" : "💪"}</span>
        <h1>{summary.perfect ? "Perfect lesson!" : `${plan.title} complete!`}</h1>
        <p className="stars" aria-label={`${summary.stars} of 3 stars`}>
          {[1, 2, 3].map((k) => <span key={k} className={k <= summary.stars ? "on" : ""} style={{ animationDelay: `${k * 0.15}s` }}>★</span>)}
        </p>
      </div>
      <div className="result-tiles four">
        <div className="tile purple"><span>XP earned</span><strong>+{summary.xp}</strong></div>
        <div className="tile green"><span>Right first time</span><strong>{Math.round(summary.share * 100)}%</strong></div>
        <div className="tile orange"><span>Best combo</span><strong>🔥 {bestCombo}</strong></div>
        <div className="tile blue"><span>Time</span><strong>{mins}:{secs}</strong></div>
      </div>

      {earned.length > 0 && (
        <div className="new-badges" role="status">
          {earned.map((b) => (
            <div key={b.id} className="badge-card earned pop"><span className="badge-icon" aria-hidden="true">{b.icon}</span>
              <span><strong>New badge: {b.name}</strong><span className="muted">{b.desc}</span></span></div>
          ))}
        </div>
      )}

      <h2 className="section-title">Your signs</h2>
      <ul className="review-list">
        {summary.signs.map((s) => {
          const label = labelOf(vocab, s.signId);
          const fix = s.tip ? fixesFor(s.tip, 1)[0] : null;
          const shown = open === s.signId;
          return (
            <li key={s.signId} className={`review-row ${s.ok ? "ok" : "work"}`}>
              <div className="review-head">
                <strong className="review-sign">{label}</strong>
                <span className="review-marks">
                  {s.marks.map((m, k) => (
                    <span key={k} className={`mark ${m.final}`} title={`${m.retry ? "Again: " : ""}${TYPE[m.type]}: ${m.final}`}>
                      {MARK[m.final]} <span className="mark-type">{m.retry ? "Again" : TYPE[m.type]}</span>
                    </span>
                  ))}
                </span>
                {s.bestCloseness !== null && <span className="review-close">Best closeness {Math.round(s.bestCloseness)}%</span>}
              </div>
              {fix && <p className="review-tip">To fix: {describeIssue(fix)}</p>}
              {s.replay && (
                <button type="button" className="button small" onClick={() => setOpen(shown ? null : s.signId)} aria-expanded={shown}>
                  {shown ? "Hide comparison" : "🎬 Compare side by side"}
                </button>
              )}
              {shown && (
                <SideBySide signId={s.signId} label={label} frames={s.replay.frames}
                  issues={fixesFor(s.replay, 2)} template={templatesRef.current?.[s.signId]?.mean} features={s.replay.features} />
              )}
            </li>
          );
        })}
        {summary.phrases.map((p, k) => (
          <li key={`phrase-${k}`} className={`review-row ${p.verdict === "correct" ? "ok" : "work"}`}>
            <div className="review-head">
              <strong className="review-sign">💬 {p.phrase.gloss}</strong>
              <span className={`mark ${p.verdict}`}>{MARK[p.verdict]} <span className="mark-type">Phrase</span></span>
            </div>
          </li>
        ))}
      </ul>

      {summary.needsWork.length > 0 && (
        <div className="needs-work card">
          <strong>Worth practising again:</strong>{" "}
          {summary.needsWork.map((id) => <span key={id} className="chip">{labelOf(vocab, id)}</span>)}
          <p className="muted">Signs you keep finding hard also show up in <a href="#/review">Practise weak signs</a>.</p>
        </div>
      )}

      <p className="celebrate-actions summary-actions">
        <a className="button" href={plan.back}>Continue</a>
        {nextHref && <a className="button primary" href={nextHref}>{nextLabel}</a>}
      </p>
    </section>
  );
}
