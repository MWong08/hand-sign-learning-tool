// My progress (IR FR6): overall numbers, mastery per unit, recent attempts, and a CSV download
// of the full practice history (also used to analyse UAT sessions).
import { useEffect, useState } from "react";
import { ProgressBar, VERDICT_TEXT } from "../components/ui.jsx";
import { getAllAttempts } from "../lib/db.js";
import { downloadText } from "../lib/download.js";
import { describeIssue } from "../lib/diagnose.js";
import { attemptsToCsv, summarise } from "../lib/history.js";
import { unitStatus } from "../lib/progress.js";
import { labelOf } from "../lib/vocabulary.js";

const RECENT = 15;

export default function ProgressPage({ vocab, progress }) {
  const [attempts, setAttempts] = useState(null);

  useEffect(() => {
    getAllAttempts().then(setAttempts).catch(() => setAttempts([]));
  }, [progress.records]);

  if (!attempts) return <p>Loading…</p>;
  const s = summarise(attempts, progress.records);

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
                    <td>{a.mode}</td>
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
