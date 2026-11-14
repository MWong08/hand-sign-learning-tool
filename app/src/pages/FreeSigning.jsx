// Free signing: sign any vocabulary words in any order; each one is recognised as you go by the
// phrase tracker (phraseTracker.js): straight through, or with pauses, or lowering the hand.
// (Chosen on validation phrases: lower word error rate than the decoder or the pause segmenter
// alone, DEVLOG 2026-11-11.)
// Unsure guesses are shown as "?" rather than a wrong word.
// The camera only turns on when the learner presses "Start free signing" (and off again with
// "Turn camera off"); once on, signs are recognised straight away, with Pause to stop.
import { useRef, useState } from "react";
import CameraView from "../components/CameraView.jsx";
import { useSignPipeline } from "../hooks/useSignPipeline.js";
import { recogniseSign } from "../lib/judgeSign.js";
import { createPhraseTracker } from "../lib/phraseTracker.js";
import { labelOf } from "../lib/vocabulary.js";

const MIN_CONFIDENCE = 0.4; // below this the guess is shown as "?"

export default function FreeSigning({ vocab, progress }) {
  const [on, setOn] = useState(false);
  const total = vocab.units.reduce((n, u) => n + u.signs.length, 0);
  const turn = (value) => {
    setOn(value);
    progress.logAction(value ? "camera-on" : "camera-off", "free");
  };
  return (
    <section>
      <h1>Free signing</h1>
      <p className="muted">
        Sign any of the curriculum's {total} words, in any order. Go straight from one sign to the next, or pause between them.
      </p>
      {on ? <FreeSigningSession vocab={vocab} progress={progress} onStop={() => turn(false)} /> : (
        <div className="card free-intro">
          <span className="free-intro-icon" aria-hidden="true">📷</span>
          <p>Your camera stays off until you start. Nothing is recorded or uploaded: signs are recognised on this device.</p>
          <button type="button" className="button primary start-free" onClick={() => turn(true)}>▶ Start free signing</button>
        </div>
      )}
    </section>
  );
}

function FreeSigningSession({ vocab, progress, onStop }) {
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
  }, { autoStart: true, log: (type) => progress.logAction(type, "free") });

  const restart = () => {
    trackerRef.current = null;
    setWords([]);
    progress.logAction("restart", "free");
  };

  return (
    <>
      <div className="practice-grid">
        <div>
          <CameraView {...pipeline} onRestart={words.length > 0 ? restart : undefined} restartLabel="Clear and restart" />
          {pipeline.detecting && (
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
          <button type="button" className="button small" onClick={onStop}>■ Turn camera off</button>
        </div>
      </div>
    </>
  );
}
