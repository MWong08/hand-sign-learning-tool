// One chip per sign of a phrase: how it was joined to the one before, the verdict and closeness,
// and for a wrong sign what it looked like and the main thing to fix. Used by phrase practice and
// by the phrase exercise in lessons.
import { describeIssue, fixesFor } from "../lib/diagnose.js";
import { labelOf } from "../lib/vocabulary.js";
import { JOINED_TEXT, VERDICT_TEXT } from "./ui.jsx";

export default function PhraseChips({ signs, labels, results, vocab }) {
  return (
    <ol className="phrase-results">
      {signs.map((s, i) => {
        const r = results[i];
        const fix = r && r.verdict !== "correct" ? fixesFor(r, 1)[0] : null;
        return (
          <li key={i} className={`phrase-chip ${r ? r.verdict : i === results.length ? "current" : "pending"}`}>
            {r?.joined && <span className={`chip-joined ${r.joined}`}>{JOINED_TEXT[r.joined]}</span>}
            <span className="chip-label">{labels[i]}</span>
            {r && <span className="chip-verdict">{VERDICT_TEXT[r.verdict]}{r.closeness !== undefined && ` · ${Math.round(r.closeness)}%`}</span>}
            {r?.lookedLike && <span className="chip-detail">Looked like “{labelOf(vocab, r.lookedLike)}”</span>}
            {fix && <span className="chip-detail">{describeIssue(fix)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
