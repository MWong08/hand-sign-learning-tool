// Free signing: sign any vocabulary words in any order; each one is recognised as you go, either
// pause-segmented (segmenter.js) or, in fluent mode, without pauses (fluent.js, sliding window).
// Unsure guesses in pause mode are shown as "?" rather than a wrong word (fluent mode only
// emits confident signs).
import { useRef, useState } from "react";
import CameraView from "../components/CameraView.jsx";
import ModeSwitch, { useSigningMode } from "../components/ModeSwitch.jsx";
import { useSignPipeline } from "../hooks/useSignPipeline.js";
import { createFluentDecoder } from "../lib/fluent.js";
import { recogniseSign } from "../lib/judgeSign.js";
import { createSegmenter } from "../lib/segmenter.js";
import { labelOf } from "../lib/vocabulary.js";

const MIN_CONFIDENCE = 0.4; // below this the guess is shown as "?"

export default function FreeSigning({ vocab }) {
  const [mode, setModeState] = useSigningMode();
  const modeRef = useRef(mode);
  const splitterRef = useRef(null);
  const [words, setWords] = useState([]);
  const [signing, setSigning] = useState(false);

  const pipeline = useSignPipeline((frame, size, classifier) => {
    if (!splitterRef.current) {
      splitterRef.current = modeRef.current === "fluent"
        ? createFluentDecoder(size.width, size.height, classifier.predictBatch, classifier.labels)
        : createSegmenter(size.width, size.height);
    }
    const splitter = splitterRef.current;
    const seg = splitter.push(frame);
    setSigning(modeRef.current === "pause" ? splitter.state === "active" : frame.hands.some(Boolean));
    if (!seg) return;
    const guess = modeRef.current === "fluent" ? { sign: seg.sign, prob: seg.prob } : recogniseSign(seg.frames, size, classifier);
    if (guess) setWords((w) => [...w, guess]);
  });

  const setMode = (m) => {
    modeRef.current = m;
    setModeState(m);
    splitterRef.current = null;
  };

  return (
    <section>
      <h1>Free signing</h1>
      <p className="muted">Sign any of the curriculum's {vocab.units.reduce((n, u) => n + u.signs.length, 0)} words, in any order.</p>
      <ModeSwitch mode={mode} onChange={setMode} />
      <div className="practice-grid">
        <div>
          <CameraView {...pipeline} />
          {pipeline.status === "ready" && (
            <div className={`coach ${signing ? "signing" : "waiting"}`}>
              <span className="coach-icon" aria-hidden="true">{signing ? "👀" : "✋"}</span>
              {mode === "fluent" ? "Sign straight through. Words appear as they're recognised."
                : signing ? "Watching… pause or lower your hand to finish the sign." : "Raise your hand and sign."}
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
