// Side-by-side replay (supervisor meeting 2): the reference clip on the left and the learner's own
// attempt on the right, played IN STEP: the attempt is stretched to the clip's length, so the
// start, middle and end of both signs line up whatever speed each was signed at. The learner's
// hand skeleton is drawn over their picture, with the part the feedback flagged in red (a finger,
// or the hand's path for position / movement). A "skeleton" view shows the existing comparison
// (GhostHand: the attempt over the average signer).
//
// Privacy: the attempt's pictures are the small in-memory snapshots taken while detecting
// (useSignPipeline capture). They are never saved or uploaded and disappear when the lesson closes.
import { useEffect, useMemo, useRef, useState } from "react";
import { describeIssue, FINGERS } from "../lib/diagnose.js";
import { referenceVideo } from "../lib/vocabulary.js";
import GhostHand, { BONES, fingerOf } from "./GhostHand.jsx";
import { SpeedSwitch, usePreference, useVideoSpeed } from "./ui.jsx";

const COLORS = { hand: "#22c55e", flag: "#ef4444", path: "#ef4444" };
const hasHand = (f) => f.hands[0] !== null || f.hands[1] !== null;

// the frames from the first to the last one with a hand (drops the pre-roll and the lowering)
export function trimToSign(frames) {
  const first = frames.findIndex(hasHand);
  if (first === -1) return [];
  let last = frames.length - 1;
  while (!hasHand(frames[last])) last--;
  return frames.slice(first, last + 1);
}

export default function SideBySide({ signId, label, frames, issues = [], template = null, features = null }) {
  const sign = useMemo(() => trimToSign(frames).filter((f) => f.snap), [frames]);
  const [pictures, setPictures] = useState(null);
  const [playing, setPlaying] = useState(true);
  const [view, setView] = useState("replay");
  const [speed, setSpeed] = useVideoSpeed();
  const [mirror] = usePreference("video-mirror", false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const flagged = useMemo(() => new Set(issues.map((i) => i.component)), [issues]);

  // decode the snapshots once
  useEffect(() => {
    let cancelled = false;
    let made = [];
    Promise.all(sign.map((f) => f.snap))
      .then((blobs) => Promise.all(blobs.map((b) => createImageBitmap(b))))
      .then((bitmaps) => {
        made = bitmaps;
        if (cancelled) bitmaps.forEach((b) => b.close());
        else setPictures(bitmaps);
      })
      .catch(() => !cancelled && setPictures([]));
    return () => {
      cancelled = true;
      made.forEach((b) => b.close());
    };
  }, [sign]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, view]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, view]);

  // draw the attempt frame that matches the clip's current point
  useEffect(() => {
    if (view !== "replay" || !pictures?.length) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const w = pictures[0].width;
    const h = pictures[0].height;
    canvas.width = w;
    canvas.height = h;
    const showPath = flagged.has("position") || flagged.has("movement");
    const wrists = sign.map((f) => (f.hands[0] ?? f.hands[1])?.[0]).filter(Boolean);

    const drawHand = (points) => {
      for (const bone of BONES) {
        const finger = fingerOf(bone);
        const hl = finger && flagged.has(finger);
        ctx.strokeStyle = hl ? COLORS.flag : COLORS.hand;
        ctx.lineWidth = hl ? 4 : 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(points[bone[0]][0] * w, points[bone[0]][1] * h);
        ctx.lineTo(points[bone[1]][0] * w, points[bone[1]][1] * h);
        ctx.stroke();
      }
    };
    let raf;
    let shown = -1;
    const loop = () => {
      const v = videoRef.current;
      const p = v && v.duration ? v.currentTime / v.duration : 0;
      const k = Math.min(sign.length - 1, Math.floor(p * sign.length));
      // (a closed picture has width 0: the replay is being replaced)
      if (k !== shown && pictures[k].width) {
        shown = k;
        ctx.drawImage(pictures[k], 0, 0, w, h);
        if (showPath && wrists.length > 1) {
          ctx.strokeStyle = COLORS.path;
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          wrists.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        sign[k].hands.forEach((hand) => hand && drawHand(hand));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view, pictures, sign, flagged]);

  const fingerIssues = issues.filter((i) => FINGERS.includes(i.component));
  const pathIssue = flagged.has("position") || flagged.has("movement");
  const canSkeleton = template && features;

  return (
    <div className="side-by-side">
      <div className="segmented" role="tablist" aria-label="Comparison view">
        <button type="button" role="tab" aria-selected={view === "replay"} className={view === "replay" ? "on" : ""} onClick={() => setView("replay")}>
          🎬 Side by side
        </button>
        <button type="button" role="tab" aria-selected={view === "skeleton"} className={view === "skeleton" ? "on" : ""}
          onClick={() => setView("skeleton")} disabled={!canSkeleton}>
          🦴 Hand shape
        </button>
      </div>

      {view === "replay" ? (
        <>
          <div className="sbs-pair">
            <figure>
              <video ref={videoRef} className={`sbs-media ${mirror ? "mirrored" : ""}`} src={referenceVideo(signId)} autoPlay loop muted playsInline
                onLoadedData={(e) => { e.currentTarget.playbackRate = speed; }} />
              <figcaption>Demo: {label}</figcaption>
            </figure>
            <figure>
              {pictures === null && <div className="sbs-media sbs-wait">Loading your attempt…</div>}
              {pictures?.length === 0 && <div className="sbs-media sbs-wait">No replay for this attempt.</div>}
              <canvas ref={canvasRef} className="sbs-media mirrored" hidden={!pictures?.length}
                role="img" aria-label={`Your attempt at ${label}, replayed`} />
              <figcaption>You</figcaption>
            </figure>
          </div>
          <div className="sbs-controls">
            <button type="button" className="button small" onClick={() => setPlaying(!playing)}>{playing ? "⏸ Pause" : "▶ Play"}</button>
            <SpeedSwitch speed={speed} setSpeed={setSpeed} />
          </div>
        </>
      ) : (
        <GhostHand template={template} attempt={features} issues={issues} size={240}
          label="Your attempt (orange) over the correct sign (green)" />
      )}

      <p className="sbs-note">
        {issues.length > 0
          ? <>To fix: {issues.map(describeIssue).join(" ")}
            {fingerIssues.length > 0 && " The finger to fix is drawn in red."}
            {pathIssue && " The dashed red line is your hand's path."}</>
          : "Played in step: both signs start and end together."}
        {" "}Your replay stays on this device and is deleted when you leave the lesson.
      </p>
    </div>
  );
}
