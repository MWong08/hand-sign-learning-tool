// The curriculum's phrases, in two groups: short phrases (2-4 signs, level 1) and longer phrases
// (4-5 signs, level 2 in vocabulary.json). A phrase unlocks once all its signs are mastered.
import { useSkipAhead } from "../components/SkipDialog.jsx";
import { isPhraseUnlocked } from "../lib/progress.js";
import { labelOf } from "../lib/vocabulary.js";

const GROUPS = [
  { level: 1, title: "Short phrases", note: null },
  { level: 2, title: "Longer phrases", note: "4–5 signs in one flow. They use signs from several units." },
];

export default function PhraseList({ vocab, progress }) {
  const { records, unlockAll, skipped } = progress;
  const skipper = useSkipAhead(vocab, progress);
  // keep each phrase's position in vocab.phrases: it is the phrase's address (#/phrase/i)
  const indexed = vocab.phrases.map((p, i) => ({ p, i }));

  const card = ({ p, i }) => {
    const open = isPhraseUnlocked(p, records, unlockAll, skipped);
    const missing = p.signs.filter((s) => !records[s]?.mastered).map((s) => labelOf(vocab, s));
    return (
      <li key={p.gloss}>
        <a className={`phrase-card ${open ? "" : "locked"}`} href={open ? `#/phrase/${i}` : undefined} aria-disabled={!open}>
          <span className="phrase-icon" aria-hidden="true">{open ? "💬" : "🔒"}</span>
          <span className="phrase-text">
            <span className="phrase-gloss-text">{p.gloss} <span className="phrase-count">{p.signs.length} signs</span></span>
            <span className="phrase-english">“{p.english}”</span>
            {!open && <span className="unit-hint">Master first: {missing.join(", ")}</span>}
          </span>
        </a>
        {!open && (
          <button type="button" className="link-button phrase-skip" onClick={() => skipper.askPhrase(i)}>Try anyway ⏭️</button>
        )}
      </li>
    );
  };

  return (
    <section>
      <h1>Phrases</h1>
      <p className="muted">
        Put signs together. Sign the whole phrase in one go, moving straight from one sign to the next.
      </p>
      {GROUPS.map((g) => {
        const items = indexed.filter(({ p }) => (p.level ?? 1) === g.level);
        if (items.length === 0) return null;
        return (
          <div key={g.level} className="phrase-group">
            <h2>{g.title}</h2>
            {g.note && <p className="muted">{g.note}</p>}
            <ul className="phrase-list">{items.map(card)}</ul>
          </div>
        );
      })}
      {skipper.dialog}
    </section>
  );
}
