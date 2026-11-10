// Confirmation before skipping ahead to a locked unit or phrase ("jump ahead" in education apps).
// Skipping opens the item without marking anything as mastered, so the learner can still go back.
// Escape or "Keep learning in order" cancels; focus starts on the safe choice.
import { useEffect, useRef, useState } from "react";
import { skipKey } from "../lib/progress.js";
import { labelOf } from "../lib/vocabulary.js";

export default function SkipDialog({ title, children, confirmLabel, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  const onCancelRef = useRef(onCancel); // latest handler, so the effect below runs only once
  onCancelRef.current = onCancel;
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onCancelRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="celebrate-backdrop" role="dialog" aria-modal="true" aria-labelledby="skip-title"
      onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="celebrate-card skip-card">
        <div className="skip-emoji" aria-hidden="true">⏭️</div>
        <h2 id="skip-title">{title}</h2>
        <div className="muted">{children}</div>
        <div className="celebrate-actions">
          <button type="button" className="button primary" onClick={onConfirm}>{confirmLabel}</button>
          <button type="button" className="button" ref={cancelRef} onClick={onCancel}>Keep learning in order</button>
        </div>
      </div>
    </div>
  );
}

// the units before unit `index` (0-based): "Unit 1" / "Units 1 and 2" / "Units 1 to 3"
function earlierUnitsText(index) {
  if (index === 1) return "Unit 1";
  if (index === 2) return "Units 1 and 2";
  return `Units 1 to ${index}`;
}

// Shared by the path, unit page and phrase screens:
//   const skipper = useSkipAhead(vocab, progress);
//   <button onClick={() => skipper.askUnit(3)}>Skip ahead</button>   ...   {skipper.dialog}
// After confirming, the item is opened and the learner is taken to it.
export function useSkipAhead(vocab, progress) {
  const [ask, setAsk] = useState(null); // { kind: "unit" | "phrase", index }
  const cancel = () => setAsk(null);

  let dialog = null;
  if (ask?.kind === "unit") {
    const unit = vocab.units[ask.index];
    const confirm = async () => {
      await progress.skip(skipKey.unit(unit));
      setAsk(null);
      window.location.hash = `#/unit/${ask.index}`;
    };
    dialog = (
      <SkipDialog title={`Skip ahead to Unit ${ask.index + 1}?`} confirmLabel={`Skip to Unit ${ask.index + 1}`}
        onConfirm={confirm} onCancel={cancel}>
        <p>You haven't finished {earlierUnitsText(ask.index)} yet. Skipping opens “{unit.title}” now.</p>
        <p>Nothing is marked as mastered, and you can go back to earlier units any time.</p>
      </SkipDialog>
    );
  } else if (ask?.kind === "phrase") {
    const phrase = vocab.phrases[ask.index];
    const missing = phrase.signs.filter((s) => !progress.records[s]?.mastered).map((s) => labelOf(vocab, s));
    const confirm = async () => {
      await progress.skip(skipKey.phrase(phrase));
      setAsk(null);
      window.location.hash = `#/phrase/${ask.index}`;
    };
    dialog = (
      <SkipDialog title={`Try “${phrase.gloss}” now?`} confirmLabel="Try this phrase" onConfirm={confirm} onCancel={cancel}>
        <p>You haven't mastered {missing.join(", ")} yet. You'll still get feedback on every sign.</p>
      </SkipDialog>
    );
  }

  return {
    askUnit: (index) => setAsk({ kind: "unit", index }),
    askPhrase: (index) => setAsk({ kind: "phrase", index }),
    dialog,
  };
}
