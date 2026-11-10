// The curriculum's short phrases. A phrase unlocks once all its signs are mastered.
import { isPhraseUnlocked } from "../lib/progress.js";
import { labelOf } from "../lib/vocabulary.js";

export default function PhraseList({ vocab, progress }) {
  const { records, unlockAll } = progress;
  return (
    <section>
      <h1>Phrases</h1>
      <p className="muted">
        Put signs together. Pause briefly between signs, or switch to <strong>fluent mode</strong> and sign straight through.
      </p>
      <ul className="phrase-list">
        {vocab.phrases.map((p, i) => {
          const open = isPhraseUnlocked(p, records, unlockAll);
          const missing = p.signs.filter((s) => !records[s]?.mastered).map((s) => labelOf(vocab, s));
          return (
            <li key={p.gloss}>
              <a className={`phrase-card ${open ? "" : "locked"}`} href={open ? `#/phrase/${i}` : undefined} aria-disabled={!open}>
                <span className="phrase-icon" aria-hidden="true">{open ? "💬" : "🔒"}</span>
                <span className="phrase-text">
                  <span className="phrase-gloss-text">{p.gloss}</span>
                  <span className="phrase-english">“{p.english}”</span>
                  {!open && <span className="unit-hint">Master first: {missing.join(", ")}</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
