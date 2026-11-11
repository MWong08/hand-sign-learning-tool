// Small shared UI pieces.
import { useEffect, useRef, useState } from "react";
import { referenceVideo } from "../lib/vocabulary.js";

export function ProgressBar({ value, total, label }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <span className="progress" aria-label={label ?? `${value} of ${total}`}>
      <span className="progress-track"><span className="progress-fill" style={{ width: `${pct}%` }} /></span>
      <span className="progress-text">{value}/{total}</span>
    </span>
  );
}

// Remembered per browser (a viewer convenience, so plain localStorage; it may be unavailable).
export function usePreference(key, initial) {
  const [value, setValue] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? initial; } catch { return initial; }
  });
  const set = (v) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
  };
  return [value, set];
}

// Looping, muted reference clip of one sign (PopSign ASL v1.0, CC BY 4.0).
// controls: slow motion (clips are only 1.3-3.4 s long) and mirror (so the signer's hand is on
// the same side as the learner's in the mirrored camera view).
export function SignVideo({ signId, className = "", controls = false }) {
  const [slow, setSlow] = usePreference("video-slow", false);
  const [mirror, setMirror] = usePreference("video-mirror", false);
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = slow ? 0.5 : 1;
  }, [slow, signId]);
  const video = (
    <video ref={ref} className={`sign-video ${mirror ? "mirrored" : ""} ${className}`} src={referenceVideo(signId)}
      autoPlay loop muted playsInline preload="metadata"
      onLoadedData={(e) => { e.currentTarget.playbackRate = slow ? 0.5 : 1; }} />
  );
  if (!controls) return video;
  return (
    <div className="video-with-controls">
      {video}
      <div className="video-controls">
        <button type="button" className={`chip ${slow ? "on" : ""}`} aria-pressed={slow} onClick={() => setSlow(!slow)}>
          🐢 Slow
        </button>
        <button type="button" className={`chip ${mirror ? "on" : ""}`} aria-pressed={mirror} onClick={() => setMirror(!mirror)}>
          ⇆ Mirror
        </button>
      </div>
    </div>
  );
}

// A phrase's reference clips. Before the learner starts (current = null) it plays the clips one
// after another, so they can watch the whole phrase. While they sign (current = the index of the
// sign they're about to make) it shows only that sign's clip, on a loop, so the video always
// matches what they should be doing.
export function PhraseVideo({ signs, labels, current = null }) {
  const [cycle, setCycle] = useState(0);
  const focused = current !== null && current < signs.length;
  const i = focused ? current : cycle;
  return (
    <figure className="reference">
      {focused && <span className="phrase-next">Next: {labels[i]}</span>}
      <video key={`${signs[i]}-${i}-${focused}`} src={referenceVideo(signs[i])} autoPlay muted playsInline loop={focused}
        onEnded={focused ? undefined : () => setCycle((cycle + 1) % signs.length)} />
      <figcaption>
        <span className="phrase-gloss">
          {signs.map((s, k) => <span key={k} className={k === i ? "current" : ""}>{labels[k]}</span>)}
        </span>
        Clips: PopSign ASL v1.0 (Georgia Tech / DPAN), CC BY 4.0
      </figcaption>
    </figure>
  );
}

export const VERDICT_TEXT = { correct: "Correct!", close: "Almost there", incorrect: "Not quite", unclear: "Couldn't see clearly" };
// how a phrase sign followed the one before (phraseTracker.js)
export const JOINED_TEXT = { flowing: "🌊 smooth join", paused: "⏸ paused before", lowered: "⬇ hand dropped before" };
