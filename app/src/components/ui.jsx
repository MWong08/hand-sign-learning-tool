// Small shared UI pieces.
import { useEffect, useRef, useState } from "react";
import { getPref, onPrefChange, setPref } from "../lib/prefs.js";
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

// Remembered per browser (lib/prefs.js). A change made anywhere (e.g. in Settings) reaches every
// screen showing the same preference.
export function usePreference(key, initial) {
  const [value, setValue] = useState(() => getPref(key, initial));
  useEffect(() => onPrefChange((k, v) => { if (k === key) setValue(v); }), [key]);
  return [value, (v) => setPref(key, v)];
}

// Whether reference videos are shown flipped: the learner's Mirror switch, turned the other way
// for left-handed learners (so the demo signer then signs with their left hand too).
export function useMirror() {
  const [mirror, setMirror] = usePreference("video-mirror", false);
  const [hand] = usePreference("hand", "right");
  return [mirror !== (hand === "left"), () => setMirror(!mirror)];
}

// Reference clips play slower than real time by default (supervisor meeting 2: "the demo video is
// too fast"; the clips are only 1.3-3.4 s long). The learner can pick the speed; it is remembered.
export const SPEEDS = [0.5, 0.75, 1];
export const DEFAULT_SPEED = 0.75;
export function useVideoSpeed() {
  return usePreference("video-speed", DEFAULT_SPEED);
}

// Speed switch: 0.5x / 0.75x / 1x
export function SpeedSwitch({ speed, setSpeed }) {
  return (
    <div className="speed-switch" role="radiogroup" aria-label="Video speed">
      <span aria-hidden="true">🐢</span>
      {SPEEDS.map((v) => (
        <button key={v} type="button" role="radio" aria-checked={speed === v} className={speed === v ? "on" : ""} onClick={() => setSpeed(v)}>
          {v}×
        </button>
      ))}
    </div>
  );
}

// Looping, muted reference clip of one sign (PopSign ASL v1.0, CC BY 4.0), at the chosen speed.
// controls: the speed switch and mirror (so the signer's hand is on the same side as the
// learner's in the mirrored camera view).
export function SignVideo({ signId, className = "", controls = false }) {
  const [speed, setSpeed] = useVideoSpeed();
  const [mirror, toggleMirror] = useMirror();
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed, signId]);
  const video = (
    <video ref={ref} className={`sign-video ${mirror ? "mirrored" : ""} ${className}`} src={referenceVideo(signId)}
      autoPlay loop muted playsInline preload="metadata"
      onLoadedData={(e) => { e.currentTarget.playbackRate = speed; }} />
  );
  if (!controls) return video;
  return (
    <div className="video-with-controls">
      {video}
      <div className="video-controls">
        <SpeedSwitch speed={speed} setSpeed={setSpeed} />
        <button type="button" className={`chip ${mirror ? "on" : ""}`} aria-pressed={mirror} onClick={toggleMirror}>
          ⇆ Mirror
        </button>
      </div>
    </div>
  );
}

// A phrase's reference clips, in one of two modes the learner picks (remembered per browser):
//   "next"  (default) before Start, the clips play one after another so the whole phrase can be
//           watched; while signing, only the clip of the sign to make next (current), on a loop,
//           so the video always matches what they should be doing;
//   "whole" the whole phrase keeps cycling, also while signing, for learners who prefer to see
//           how the signs join up.
export function PhraseVideo({ signs, labels, current = null }) {
  const [mode, setMode] = usePreference("phrase-video", "next");
  const [cycle, setCycle] = useState(0);
  const [speed, setSpeed] = useVideoSpeed();
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);
  const focused = mode === "next" && current !== null && current < signs.length;
  const i = focused ? current : cycle;
  return (
    <figure className="reference">
      <div className="segmented" role="radiogroup" aria-label="Reference video shows">
        <button type="button" role="radio" aria-checked={mode === "next"} className={mode === "next" ? "on" : ""} onClick={() => setMode("next")}>
          Next sign
        </button>
        <button type="button" role="radio" aria-checked={mode === "whole"} className={mode === "whole" ? "on" : ""} onClick={() => setMode("whole")}>
          Whole phrase
        </button>
      </div>
      {focused && <span className="phrase-next">Next: {labels[i]}</span>}
      <video ref={videoRef} key={`${signs[i]}-${i}-${focused}`} src={referenceVideo(signs[i])} autoPlay muted playsInline loop={focused}
        onLoadedData={(e) => { e.currentTarget.playbackRate = speed; }}
        onEnded={focused ? undefined : () => setCycle((cycle + 1) % signs.length)} />
      <div className="video-controls"><SpeedSwitch speed={speed} setSpeed={setSpeed} /></div>
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
