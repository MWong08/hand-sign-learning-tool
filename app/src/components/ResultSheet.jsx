// The result of one attempt, as a coloured sheet (education-app style): verdict, XP earned,
// closeness, what it looked like, what to fix, and a side-by-side "compare" skeleton of the
// learner's attempt over the correct sign with the flagged finger / position highlighted.
// In lessons the attempt's pictures are kept in memory (frames with snapshots), so "compare" opens
// the side-by-side replay instead: the demo clip next to the learner's own attempt.
import { useState } from "react";
import { describeIssue, describePart, fixesFor } from "../lib/diagnose.js";
import { xpFor } from "../lib/gamify.js";
import { labelOf } from "../lib/vocabulary.js";
import GhostHand from "./GhostHand.jsx";
import SideBySide from "./SideBySide.jsx";

const TITLE = {
  correct: ["🎉", "Nicely done!"],
  close: ["💪", "Almost there!"],
  incorrect: ["🤔", "Not quite"],
  unclear: ["👀", "Couldn't see your hand"],
};

// attempt: a running number, so tests and assistive tech can tell a new result from the previous one
// frames: the attempt's camera frames with snapshots (lessons), for the side-by-side replay
export default function ResultSheet({ result, vocab, template, onContinue, continueLabel = "Continue", note, attempt, frames = null, signId, label }) {
  const [compare, setCompare] = useState(false);
  const v = result.verdict;
  const [emoji, title] = TITLE[v];
  // when the sign was recognised, show at most one tip; otherwise up to two things to fix,
  // starting with the part that made it look like another sign
  const issues = fixesFor(result, v === "correct" ? 1 : 2);
  const xp = xpFor(result);
  const replay = Boolean(frames?.some((f) => f.snap)) && v !== "unclear";
  const canCompare = replay || (template && result.features && v !== "unclear");

  return (
    <div className={`sheet ${v}`} role="status" data-attempt={attempt}>
      <div className="sheet-body">
        <div className="sheet-head">
          <span className="sheet-emoji" aria-hidden="true">{emoji}</span>
          <strong className="sheet-title">{title}</strong>
          {xp > 0 && <span className="xp-gain">+{xp} XP</span>}
        </div>
        {v === "unclear" && <p>Keep your head, shoulders and signing hand in view, then try again.</p>}
        {result.closeness !== undefined && (
          <div className="score">
            <span>Closeness</span>
            <span className="meter"><span style={{ width: `${result.closeness}%` }} /></span>
            <strong>{Math.round(result.closeness)}%</strong>
          </div>
        )}
        {result.lookedLike && (
          <p>
            It looked more like “{labelOf(vocab, result.lookedLike)}”
            {result.contrast ? `, mostly because of ${describePart(result.contrast.component)}.` : "."}
          </p>
        )}
        {issues.length > 0 && (
          <ul className="issues">
            {issues.map((issue) => <li key={issue.component}>{v === "correct" ? "Tip: " : ""}{describeIssue(issue)}</li>)}
          </ul>
        )}
        {note && <p className="sheet-note">{note}</p>}
        {compare && canCompare && (replay
          ? <SideBySide signId={signId} label={label} frames={frames} issues={issues} template={template} features={result.features} />
          : <GhostHand template={template} attempt={result.features} issues={issues} size={220}
            label="Your attempt (orange) over the correct sign (green)" />)}
      </div>
      <div className="sheet-actions">
        {canCompare && (
          <button type="button" className="button" onClick={() => setCompare(!compare)} aria-expanded={compare}>
            {compare ? "Hide comparison" : replay ? "🎬 Compare side by side" : "🦴 Compare with the sign"}
          </button>
        )}
        {onContinue && <button type="button" className={`button primary ${v}`} onClick={onContinue}>{continueLabel}</button>}
      </div>
    </div>
  );
}
