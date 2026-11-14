// Home: the curriculum as a learning path (IR FR4). Each unit is a coloured banner followed by
// a trail of round buttons, one per sign, then the unit review; units unlock in order as the
// previous one is mastered. Signs are taught in lessons of 2-4 (lib/lesson.js): a sign's button
// opens its lesson, the first sign of each lesson is marked "Lesson N" (with its stars), and the
// next lesson is marked "Start". Supervisor meeting 2 found the path too long; the follow-up
// sketch asked to keep every sign but zigzag them left and right, closer together (each button
// beside the last one rather than below it), with a line joining them (App.css .trail.zigzag).
// Beside the path: weak-sign review, phrases, quiz, free signing and text to sign.
import { useSkipAhead } from "../components/SkipDialog.jsx";
import { bestStars, lessonsOf, unitReviewKey } from "../lib/lesson.js";
import { isPhraseUnlocked, isUnitUnlocked, unitStatus } from "../lib/progress.js";
import { weakSigns } from "../lib/review.js";
import { labelOf } from "../lib/vocabulary.js";

export const UNIT_COLORS = ["#22a35a", "#1d8fe0", "#9b51e0", "#e8590c", "#d6336c", "#0ca678", "#f59f00", "#5c7cfa"];

// lesson stars, e.g. ★★☆
function Stars({ n }) {
  return <span className="node-stars">{"★".repeat(n)}<span className="off">{"★".repeat(3 - n)}</span></span>;
}

// a link on the path; when locked, a button that offers to skip ahead (SkipDialog.jsx)
function PathLink({ open, href, onLocked, label, lockedLabel, className, children }) {
  return open
    ? <a className={className} href={href} aria-label={label}>{children}</a>
    : <button type="button" className={className} onClick={onLocked} aria-label={lockedLabel}>{children}</button>;
}

export default function Home({ vocab, progress }) {
  const { records, unlockAll, skipped, game, attempts } = progress;
  const stars = bestStars(progress.lessons);
  const unlockedSigns = vocab.units.filter((_, k) => isUnitUnlocked(vocab.units, k, records, unlockAll, skipped)).flatMap((x) => x.signs.map((sg) => sg.id));
  const toReview = weakSigns(attempts, unlockedSigns).length;
  const firstLocked = vocab.units.findIndex((_, k) => !isUnitUnlocked(vocab.units, k, records, unlockAll, skipped));
  const skipper = useSkipAhead(vocab, progress);
  const phrasesOpen = vocab.phrases.filter((p) => isPhraseUnlocked(p, records, unlockAll, skipped)).length;
  const newcomer = Object.keys(records).length === 0;
  // the "current" unit: first unlocked one not yet complete
  const currentUnit = vocab.units.findIndex((u, i) => isUnitUnlocked(vocab.units, i, records, unlockAll, skipped) && !unitStatus(u, records).complete);

  return (
    <section className="home">
      <div className="daily-card">
        <div>
          <h1>{newcomer ? "Welcome! Let's learn to sign 👋" : game.goalMet ? "Daily goal reached! 🎉" : "Keep it going!"}</h1>
          <p className="muted">
            {newcomer
              ? <>Real-time feedback on your American Sign Language, right from your camera. New here? <a href="#/help">Set up in 1 minute</a>.</>
              : <>Daily goal: <strong>{Math.min(game.todayXp, game.goal)} / {game.goal} XP</strong>{game.streak > 0 && <> · 🔥 {game.streak}-day streak</>}</>}
          </p>
          <div className="goal-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (game.todayXp / game.goal) * 100)}%` }} /></div>
        </div>
      </div>

      <ol className="path">
        {vocab.units.map((unit, u) => {
          const open = isUnitUnlocked(vocab.units, u, records, unlockAll, skipped);
          const status = unitStatus(unit, records);
          const color = UNIT_COLORS[u % UNIT_COLORS.length];
          const lessons = lessonsOf(vocab, u);
          const allMastered = (signs) => signs.every((id) => records[id]?.mastered);
          // the next step in the current unit: the first lesson not done yet, then the unit review
          let next = -1;
          if (u === currentUnit) {
            next = lessons.findIndex((l) => !stars[l.key] && !allMastered(l.signs));
            if (next === -1 && !status.complete) next = lessons.length;
          }
          return (
            <li key={unit.id} className={`path-unit ${open ? "" : "locked"}`} style={{ "--unit": color }}>
              <PathLink className="unit-banner" open={open} href={`#/unit/${u}`} onLocked={() => skipper.askUnit(u)}
                lockedLabel={`Unit ${u + 1}, ${unit.title}: locked. Skip ahead?`}>
                <span>
                  <span className="unit-number">Unit {u + 1}</span>
                  <span className="unit-name">{unit.title}</span>
                </span>
                <span className="unit-banner-side">
                  {status.complete ? "🏆" : open ? `${status.mastered}/${status.total}` : "🔒 Skip ahead"}
                </span>
              </PathLink>
              {/* every sign is a step on the path, zigzagging left and right (supervisor's sketch) */}
              <ol className="trail zigzag">
                {lessons.flatMap((l, i) => l.signs.map((id, k) => {
                  const done = stars[l.key] ?? 0;
                  const mastered = Boolean(records[id]?.mastered);
                  const first = k === 0;
                  const isNext = open && i === next && first;
                  const state = !open ? "locked" : mastered ? "mastered" : i === next ? "current" : done ? "done" : "open";
                  const label = labelOf(vocab, id);
                  return (
                    <li key={id}>
                      <PathLink className={`node ${state}`} open={open} href={`#/lesson/${u}/${i}`} onLocked={() => skipper.askUnit(u)}
                        label={`${label}: lesson ${i + 1}${mastered ? ", mastered" : ""}${done ? `, ${done} of 3 stars` : ""}`}
                        lockedLabel={`${label}: locked. Skip ahead to Unit ${u + 1}?`}>
                        {isNext && <span className="node-start">Start</span>}
                        <span className="node-face" aria-hidden="true">{state === "locked" ? "🔒" : mastered ? "★" : done ? "✓" : "✋"}</span>
                      </PathLink>
                      <span className="node-label" aria-hidden="true">
                        {first && <span className="node-kicker">Lesson {i + 1}{done > 0 && <> <Stars n={done} /></>}</span>}
                        <strong>{label}</strong>
                      </span>
                    </li>
                  );
                }))}
                <li>
                  <PathLink className={`node review ${!open ? "locked" : status.complete ? "mastered" : next === lessons.length ? "current" : "open"}`}
                    open={open} href={`#/lesson/${u}/review`} onLocked={() => skipper.askUnit(u)}
                    label={`Unit ${u + 1} review: every sign of the unit, mixed`} lockedLabel={`Unit ${u + 1} review: locked. Skip ahead?`}>
                    {open && next === lessons.length && <span className="node-start">Start</span>}
                    <span className="node-face" aria-hidden="true">🏆</span>
                  </PathLink>
                  <span className="node-label" aria-hidden="true">
                    <span className="node-kicker">Unit review{stars[unitReviewKey(unit)] > 0 && <> <Stars n={stars[unitReviewKey(unit)]} /></>}</span>
                    <strong>All {unit.signs.length} signs</strong>
                  </span>
                </li>
              </ol>
              {/* the hint only under the first locked unit: the later banners already say "Skip ahead" */}
              {!open && u === firstLocked && (
                <p className="unit-hint">
                  Master Unit {u} to unlock{" "}
                  <button type="button" className="link-button" onClick={() => skipper.askUnit(u)}>or skip ahead ⏭️</button>
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="home-modes">
      <h2 className="section-title">Beyond single words</h2>
      <div className="mode-tiles">
        <a className="mode-tile review" href="#/review">
          <span className="mode-icon" aria-hidden="true">🔁</span>
          <span className="mode-name">Practise weak signs</span>
          <span className="mode-desc">{toReview ? `${toReview} sign${toReview > 1 ? "s" : ""} to go over again, with a side-by-side replay.` : "Signs you find hard will show up here."}</span>
        </a>
        <a className="mode-tile phrases" href="#/phrases">
          <span className="mode-icon" aria-hidden="true">💬</span>
          <span className="mode-name">Phrases</span>
          <span className="mode-desc">Sign short phrases like “Hello, my mom”. {phrasesOpen} of {vocab.phrases.length} unlocked.</span>
        </a>
        <a className="mode-tile quiz" href="#/quiz">
          <span className="mode-icon" aria-hidden="true">🎯</span>
          <span className="mode-name">Quiz</span>
          <span className="mode-desc">Sign words from memory. The answer appears after you try.</span>
        </a>
        <a className="mode-tile free" href="#/free">
          <span className="mode-icon" aria-hidden="true">✋</span>
          <span className="mode-name">Free signing</span>
          <span className="mode-desc">Sign any words in any order and watch them appear.</span>
        </a>
        <a className="mode-tile translate" href="#/translate">
          <span className="mode-icon" aria-hidden="true">🔤</span>
          <span className="mode-name">Text to sign</span>
          <span className="mode-desc">Type or drag words into a sentence and watch it signed.</span>
        </a>
      </div>
      </div>
      {skipper.dialog}
    </section>
  );
}
