// My progress (IR FR6): overall numbers, badges, signs to review, mastery per unit, recent
// attempts, and a CSV download of the full practice history (also used to analyse UAT sessions).
import { useEffect, useState } from "react";
import { ProgressBar, VERDICT_TEXT } from "../components/ui.jsx";
import { getAllAttempts } from "../lib/db.js";
import { downloadText } from "../lib/download.js";
import { describeIssue } from "../lib/diagnose.js";
import { badgeList, badgeStats } from "../lib/badges.js";
import { attemptsToCsv, summarise } from "../lib/history.js";
import { isUnitUnlocked, unitStatus } from "../lib/progress.js";
import { weakSigns } from "../lib/review.js";
import { labelOf } from "../lib/vocabulary.js";

const RECENT = 15;
const EXERCISE_TEXT = { watch: "copy", recall: "from memory", "pick-word": "recognise", "pick-video": "find the video", phrase: "phrase" };

export default function ProgressPage({ vocab, progress }) {
  const [attempts, setAttempts] = useState(null);

  useEffect(() => {
    getAllAttempts().then(setAttempts).catch(() => setAttempts([]));
  }, [progress.records]);

  if (!attempts) return <p>Loading…</p>;
  const s = summarise(attempts, progress.records);
  const badges = badgeList(badgeStats(vocab, attempts, progress.records, progress.lessons, progress.game));
  const unlocked = vocab.units.filter((_, k) => isUnitUnlocked(vocab.units, k, progress.records, progress.unlockAll, progress.skipped))
    .flatMap((u) => u.signs.map((x) => x.id));
  const weak = weakSigns(attempts, unlocked);

  const download = () =>
    downloadText(`sign-practice-history-${new Date().toISOString().slice(0, 10)}.csv`, attemptsToCsv(attempts));

  return (
    <section>
      <h1>My progress</h1>
      <dl className="stat-tiles">
        <div className="tile orange"><dt>🔥 Day streak</dt><dd>{progress.game.streak}</dd></div>
        <div className="tile purple"><dt>⚡ Total XP</dt><dd>{progress.game.xp}</dd></div>
        <div className="tile gold"><dt>★ Signs mastered</dt><dd>{s.mastered}</dd></div>
        <div className="tile green"><dt>✓ Correct</dt><dd>{s.accuracy}%</dd></div>
        <div className="tile blue"><dt>🎯 Avg. closeness</dt><dd>{s.averageCloseness}%</dd></div>
        <div className="tile"><dt>📅 Days practised</dt><dd>{s.daysPractised}</dd></div>
        <div className="tile"><dt>✋ Attempts</dt><dd>{s.attempts}</dd></div>
      </dl>

      <h3>Badges <span className="muted">{badges.filter((b) => b.earned).length} of {badges.length}</span></h3>
      <ul className="badge-grid">
        {badges.map((b) => (
          <li key={b.id} className={`badge-card ${b.earned ? "earned" : "locked"}`}>
            <span className="badge-icon" aria-hidden="true">{b.earned ? b.icon : "🔒"}</span>
            <span><strong>{b.name}</strong><span className="muted">{b.desc}</span></span>
            <span className="sr-only">{b.earned ? "earned" : "not earned yet"}</span>
          </li>
        ))}
      </ul>

      <h3>Signs to review</h3>
      {weak.length === 0
        ? <p className="muted">No weak signs right now.</p>
        : (
          <p className="review-chips left">
            {weak.map((w) => <span key={w.signId} className="chip">{labelOf(vocab, w.signId)} · {Math.round(w.accuracy * 100)}% right</span>)}
            <a className="button small primary" href="#/review">Practise them</a>
          </p>
        )}

      <h3>Units</h3>
      <ul className="unit-progress">
        {vocab.units.map((u, i) => {
          const st = unitStatus(u, progress.records);
          return (
            <li key={u.id}>
              <a href={`#/unit/${i}`}>Unit {i + 1}: {u.title}</a>
              <ProgressBar value={st.mastered} total={st.total} label={`${st.mastered} of ${st.total} mastered`} />
            </li>
          );
        })}
      </ul>

      <h3>Recent attempts</h3>
      {attempts.length === 0
        ? <p className="muted">No attempts yet. <a href="#/unit/0">Start with Unit 1</a>.</p>
        : (
          <div className="table-wrap">
            <table className="attempts">
              <thead><tr><th>When</th><th>Sign</th><th>Mode</th><th>Result</th><th>Closeness</th><th>Tip</th></tr></thead>
              <tbody>
                {attempts.slice(-RECENT).reverse().map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</td>
                    <td>{labelOf(vocab, a.signId)}</td>
                    <td>{a.exercise ? `${a.mode}: ${EXERCISE_TEXT[a.exercise] ?? a.exercise}` : a.mode}</td>
                    <td className={`verdict-${a.verdict}`}>{VERDICT_TEXT[a.verdict]}</td>
                    <td>{a.closeness === undefined ? "–" : `${Math.round(a.closeness)}%`}</td>
                    <td>{a.issues?.[0] ? describeIssue(a.issues[0]) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {attempts.length > 0 && (
        <p><button type="button" className="button" onClick={download}>Download full history (CSV)</button></p>
      )}
    </section>
  );
}
