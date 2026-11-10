// Home: the curriculum as a learning path (IR FR4). Each unit is a coloured banner followed by
// a winding trail of round sign buttons; units unlock in order as the previous one is mastered.
// The next sign to learn is marked "Start". Below the path: phrases, quiz and free signing.
import { useSkipAhead } from "../components/SkipDialog.jsx";
import { isPhraseUnlocked, isUnitUnlocked, nextSignIndex, unitStatus } from "../lib/progress.js";

export const UNIT_COLORS = ["#22a35a", "#1d8fe0", "#9b51e0", "#e8590c", "#d6336c", "#0ca678", "#f59f00", "#5c7cfa"];
const SWING = [0, 1, 1.6, 1, 0, -1, -1.6, -1]; // trail offsets, in steps of 36 px

// a link on the path; when locked, a button that offers to skip ahead (SkipDialog.jsx)
function PathLink({ open, href, onLocked, label, lockedLabel, className, children }) {
  return open
    ? <a className={className} href={href} aria-label={label}>{children}</a>
    : <button type="button" className={className} onClick={onLocked} aria-label={lockedLabel}>{children}</button>;
}

export default function Home({ vocab, progress }) {
  const { records, unlockAll, skipped, game } = progress;
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
          const next = nextSignIndex(unit, records);
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
              <ol className="trail">
                {unit.signs.map((sign, i) => {
                  const r = records[sign.id];
                  const isNext = open && u === currentUnit && i === next && !r?.mastered;
                  const state = !open ? "locked" : r?.mastered ? "mastered" : isNext ? "current" : r ? "started" : "open";
                  return (
                    <li key={sign.id} style={{ "--swing": SWING[i % SWING.length] }}>
                      <PathLink className={`node ${state}`} open={open} href={`#/practice/${u}/${i}`} onLocked={() => skipper.askUnit(u)}
                        label={`${sign.label}: ${state === "mastered" ? "mastered" : "practise"}`}
                        lockedLabel={`${sign.label}: locked. Skip ahead to Unit ${u + 1}?`}>
                        {isNext && <span className="node-start">Start</span>}
                        <span className="node-face" aria-hidden="true">{state === "mastered" ? "★" : state === "locked" ? "🔒" : "✋"}</span>
                      </PathLink>
                      <span className="node-label">{sign.label}</span>
                    </li>
                  );
                })}
              </ol>
              {!open && (
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
      </div>
      </div>
      {skipper.dialog}
    </section>
  );
}
