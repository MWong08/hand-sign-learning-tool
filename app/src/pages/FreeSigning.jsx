// Free signing: sign any vocabulary words in any order; each one is recognised as you go by the
// phrase tracker (phraseTracker.js): straight through, or with pauses, or lowering the hand.
// (Chosen on validation phrases: lower word error rate than the decoder or the pause segmenter
// alone, DEVLOG 2026-11-11.)
// Unsure guesses are shown as "?" rather than a wrong word.
import { useRef, useState } from "react";
import CameraView from "../components/CameraView.jsx";
import { useSignPipeline } from "../hooks/useSignPipeline.js";
import { recogniseSign } from "../lib/judgeSign.js";
import { createPhraseTracker } from "../lib/phraseTracker.js";
import { labelOf } from "../lib/vocabulary.js";

const MIN_CONFIDENCE = 0.4; // below this the guess is shown as "?"

export default function FreeSigning({ vocab }) {
  const trackerRef = useRef(null);
  const [words, setWords] = useState([]);
  const [signing, setSigning] = useState(false);
  const [stillness, setStillness] = useState(0);

  const pipeline = useSignPipeline((frame, size, classifier) => {
    trackerRef.current ??= createPhraseTracker(size.width, size.height, classifier, null);
    const tracker = trackerRef.current;
    const found = tracker.push(frame);
    setSigning(frame.hands.some(Boolean));
    setStillness(Math.round(tracker.stillness * 11) / 11);
    if (!found) return;
    const guess = recogniseSign(found.frames, size, classifier); // { sign, prob }
    if (guess) setWords((w) => [...w, guess]);
  });

  return (
    <section>
      <h1>Free signing</h1>
      <p className="muted">
        Sign any of the curriculum's {vocab.units.reduce((n, u) => n + u.signs.length, 0)} words, in any order. Go straight
        from one sign to the next, or pause between them.
      </p>
      <div className="practice-grid">
        <div>
          <CameraView {...pipeline} />
          {pipeline.status === "ready" && (
            <div className={`coach ${signing ? "signing" : "waiting"}`}>
              <span className="coach-icon still-ring" style={{ "--still": stillness }} aria-hidden="true">{signing ? "👀" : "✋"}</span>
              {signing ? "Watching… words appear as they're recognised." : "Raise your hand and sign."}
            </div>
          )}
        </div>
        <div className="card transcript-card">
          <h3>What you signed</h3>
          <p className="transcript">
            {words.length === 0 && <span className="muted">Your signs will appear here.</span>}
            {words.map((w, i) => (
              <span key={i} className={`word ${w.prob >= MIN_CONFIDENCE ? "" : "unsure"}`}
                title={`${labelOf(vocab, w.sign)} (${Math.round(w.prob * 100)}%)`}>
                {w.prob >= MIN_CONFIDENCE ? labelOf(vocab, w.sign) : "?"}
              </span>
            ))}
          </p>
          {words.length > 0 && <button type="button" className="button" onClick={() => setWords([])}>Clear</button>}
        </div>
      </div>
    </section>
  );
}
