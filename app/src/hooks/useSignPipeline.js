// Shared live pipeline: webcam -> MediaPipe landmarks at 15 fps -> onFrame(frame, size, classifier, framing).
// Used by every screen that watches the learner (practice, free recognition).
//
// Returns refs for the <video> and overlay <canvas>, the loaded classifier and status, and the
// framing check ({ ok, issue }: is the learner set up so recognition can work; lib/framing.js).
//
// Start / pause: the camera, skeleton overlay and set-up check run as soon as the screen opens,
// so the learner can get into position, but frames only reach the page (onFrame), i.e. signs
// are only detected, after they press Start. `detecting`, `start()` and `pause()` drive the
// controls in CameraView. options: { autoStart: detect straight away (developer view),
// onStart: called on every start, e.g. to drop a half-recorded attempt, log(type): UAT logging,
// capture: also give each detected frame a small picture of the camera (frame.snap, a promise of
// a JPEG Blob) for the side-by-side replay in lessons. The pictures only live in memory, on the
// page that asked for them; they are never saved or uploaded }.
import { useEffect, useRef, useState } from "react";
import { createClassifier } from "../lib/classifier.js";
import { createFramingMonitor, measureLuma } from "../lib/framing.js";
import { createLandmarkers, detectFrame } from "../lib/landmarks.js";

export const FPS = 15; // same rate as the training data (every 2nd frame of 30 fps video)

// Moving on to the next sign in a lesson opens a new screen. If the learner was already
// detecting, it carries on there, so Start isn't needed for every sign.
let carryOn = false;
export function keepDetectingOnNextScreen() {
  carryOn = true;
}

export function useSignPipeline(onFrame, options = {}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame; // always call the latest callback without restarting the loop
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [detecting, setDetecting] = useState(() => Boolean(options.autoStart) || carryOn);
  const detectingRef = useRef(detecting);
  useEffect(() => { carryOn = false; }, []);
  const setDetectingBoth = (value) => {
    detectingRef.current = value;
    setDetecting(value);
  };
  const start = () => {
    optionsRef.current.onStart?.();
    setDetectingBoth(true);
    optionsRef.current.log?.("start");
  };
  const pause = () => {
    setDetectingBoth(false);
    optionsRef.current.log?.("pause");
  };

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [classifier, setClassifier] = useState(null);
  const [landmarksMs, setLandmarksMs] = useState(0);
  const [framing, setFraming] = useState({ ready: false, ok: true, issue: null });

  useEffect(() => {
    let stopped = false;
    let stream;
    let lastFrameTime = 0;
    let frameCount = 0;
    const framingMonitor = createFramingMonitor();
    const lumaCanvas = document.createElement("canvas");
    const snapCanvas = document.createElement("canvas");
    let shown = "pending";

    async function start() {
      try {
        const [landmarkers, clf] = await Promise.all([createLandmarkers(), createClassifier()]);
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
        if (stopped) {
          // unmounted while loading (React dev mode mounts twice)
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setClassifier(clf);
        setStatus("ready");

        const loop = () => {
          if (stopped) return;
          const now = performance.now();
          // the browser calls this once per screen refresh (~16.7 ms); the small tolerance stops a
          // frame that is due by a fraction of a millisecond from slipping to the next refresh,
          // which would cut the rate from 15 to ~13 fps
          if (video.readyState >= 2 && now - lastFrameTime >= 1000 / FPS - 4) {
            lastFrameTime = now;
            const t0 = performance.now();
            const frame = detectFrame(landmarkers, video, Math.round(now));
            if (++frameCount % 15 === 0) setLandmarksMs(performance.now() - t0);
            if (import.meta.env.DEV) window.__pipelineFrames = frameCount; // dev-only: lets tests measure the processed frame rate
            drawOverlay(canvasRef.current, video, frame);
            const size = { width: video.videoWidth, height: video.videoHeight };
            const luma = frameCount % 15 === 1 ? measureLuma(video, lumaCanvas) : null; // once a second
            const check = framingMonitor.push(frame, size, luma);
            const key = check.ready ? (check.issue?.code ?? "ok") : "pending";
            if (key !== shown) { // re-render only when the message changes
              shown = key;
              setFraming({ ready: check.ready, ok: check.ok, issue: check.issue });
            }
            if (detectingRef.current) {
              if (optionsRef.current.capture) frame.snap = snapshot(video, snapCanvas);
              onFrameRef.current?.(frame, size, clf, check);
            }
          }
          requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        setError(err.name === "NotAllowedError" ? "Camera permission was denied." : err.message);
        setStatus("error");
      }
    }

    start();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { videoRef, canvasRef, status, error, classifier, landmarksMs, framing, detecting, start, pause };
}

// A small JPEG of the current camera picture (unmirrored, like the landmarks). toBlob copies the
// canvas straight away, so one canvas can be reused for every frame.
const SNAP_WIDTH = 240;
function snapshot(video, canvas) {
  const w = SNAP_WIDTH;
  const h = Math.round((SNAP_WIDTH * video.videoHeight) / video.videoWidth);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.getContext("2d").drawImage(video, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
}

// Hand joints (amber = MediaPipe "Left" slot, green = "Right") and the body reference points
// the features use (blue: nose and shoulders).
function drawOverlay(canvas, video, frame) {
  if (!canvas) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dot = ([x, y], color, r) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * canvas.width, y * canvas.height, r, 0, 2 * Math.PI);
    ctx.fill();
  };
  frame.hands.forEach((hand, slot) => hand?.forEach((p) => dot(p, slot === 0 ? "#f59e0b" : "#22c55e", 4)));
  if (frame.pose) [0, 11, 12].forEach((i) => dot(frame.pose[i], "#3b82f6", 6));
}
