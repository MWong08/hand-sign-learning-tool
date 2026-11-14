// Developer view: free recognition of any vocabulary sign, with live top-3 and timings.
// (The original prototype; kept for testing the recognition pipeline and for the report.)
import { useRef, useState } from "react";
import CameraView from "../components/CameraView.jsx";
import { useSignPipeline } from "../hooks/useSignPipeline.js";
import { preprocessFrames } from "../lib/preprocess.js";
import { labelOf } from "../lib/vocabulary.js";

const BUFFER_FRAMES = 45;  // 3 s of history; preprocessing trims it to the active sign
const PREDICT_EVERY = 5;   // classify every 5 frames (~3 times a second)

export default function LiveRecognition({ vocab }) {
  const bufferRef = useRef([]);
  const countRef = useRef(0);
  const [predictions, setPredictions] = useState([]);
  const [modelMs, setModelMs] = useState(0);

  const pipeline = useSignPipeline((frame, size, classifier) => {
    const buffer = bufferRef.current;
    buffer.push(frame);
    if (buffer.length > BUFFER_FRAMES) buffer.shift();
    if (++countRef.current % PREDICT_EVERY !== 0) return;
    const features = preprocessFrames(buffer, size.width, size.height);
    if (!features) return;
    const t0 = performance.now();
    setPredictions(classifier.predict(features).slice(0, 3));
    setModelMs(performance.now() - t0);
  }, { autoStart: true, noCountdown: true });

  return (
    <section>
      <h2>Live recognition (developer view)</h2>
      <CameraView {...pipeline} />
      <ol className="predictions">
        {predictions.map((p) => (
          <li key={p.sign}>
            <span className="sign">{labelOf(vocab, p.sign)}</span>
            <span className="bar" style={{ width: `${Math.round(p.prob * 100)}%` }} />
            <span className="prob">{(p.prob * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ol>
      <p className="timing">
        landmarks {pipeline.landmarksMs.toFixed(1)} ms · model {modelMs.toFixed(1)} ms ·
        TF.js backend: {pipeline.classifier?.backend ?? "…"}
      </p>
    </section>
  );
}
