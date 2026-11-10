// Camera framing check: warns when the learner is set up in a way that makes recognition
// unreliable (out of view, too close or far, head or shoulders cut off, too dark, hand leaving
// the picture). It only advises: practice keeps running whatever it says.
//
// Thresholds sit well outside the framing of the training videos (PopSign, measured over the
// 12,270 training videos, DEVLOG 2026-11-08), so a set-up like the training data never warns:
//   shoulder width / frame height  p1 0.30  p5 0.35  p50 0.44  p95 0.51  p99 0.54
//   nose height (y / frame height) p1 0.28  p50 0.41
//   shoulder midpoint height       p50 0.65  p99 0.81
//   shoulder midpoint across (x)   p1 0.32  p99 0.64
//   shoulder visibility            p1 0.98; pose found in >96% of frames of 99% of videos
// The features are scale-normalised (by shoulder width and hand size), so distance itself does
// not matter much; what matters is that the hands stay big enough to track and that the face
// and shoulders (the reference points) stay in view.

export const FRAMING = {
  windowFrames: 15,        // judge over the last second (15 fps), not a single frame
  showShare: 0.6,          // show an issue once it holds in 60% of the window ...
  hideShare: 0.3,          // ... and hide it again only below 30% (no flicker)
  minShoulderWidth: 0.18,  // shoulder width / frame height: below this, hands are too small
  maxShoulderWidth: 0.75,  // above this, signs near the head and chest leave the picture
  minNoseY: 0.1,           // nose above this height: the top of the head is cut off
  maxShoulderY: 0.95,      // shoulders below this height: they are (nearly) out of the picture
  minMidX: 0.2,            // body centre this close to a side edge
  maxMidX: 0.8,
  minVisibility: 0.5,      // MediaPipe's "is this point in view" score for shoulders and nose
  handEdge: 0.01,          // a hand joint this close to the top or a side edge
  darkLuma: 50,            // mean brightness (0-255) of the camera picture
  brightLuma: 235,
};

// In priority order: only the first active issue is shown, so the learner fixes one thing at a time.
export const FRAMING_ISSUES = [
  { code: "noPerson", message: "We can't see you. Sit facing the camera with your head and shoulders in view." },
  { code: "dark", message: "It's too dark. Turn on a light in front of you." },
  { code: "bright", message: "The picture is too bright. Avoid sitting facing a strong light or window glare." },
  { code: "tooClose", message: "You're too close. Move back so your head, shoulders and chest fit in the picture." },
  { code: "headCut", message: "Your head is cut off. Move back a little or tilt the camera up." },
  { code: "shouldersHidden", message: "Your shoulders are out of view. Move back a little or tilt the camera down." },
  { code: "tooFar", message: "You're too far away. Move closer to the camera." },
  { code: "offCentre", message: "Move to the centre of the picture." },
  { code: "handEdge", message: "Your hand is leaving the picture. Sign a little closer to your body." },
];
const ORDER = FRAMING_ISSUES.map((i) => i.code);

// Issue codes for a single frame. size: { width, height } of the camera picture;
// luma: mean brightness 0-255, or null when not measured for this frame.
export function frameIssues(frame, size, luma = null, o = FRAMING) {
  const issues = [];
  if (luma !== null && luma < o.darkLuma) issues.push("dark");
  if (luma !== null && luma > o.brightLuma) issues.push("bright");

  const pose = frame.pose;
  if (!pose) {
    issues.push("noPerson");
    return issues;
  }
  const [nose, ls, rs] = [pose[0], pose[11], pose[12]];
  const shoulderWidth = Math.hypot((ls[0] - rs[0]) * size.width, (ls[1] - rs[1]) * size.height) / size.height;
  const midX = (ls[0] + rs[0]) / 2;
  const midY = (ls[1] + rs[1]) / 2;
  const visible = (p) => (p[3] ?? 1) >= o.minVisibility;

  if (shoulderWidth > o.maxShoulderWidth) issues.push("tooClose");
  else if (shoulderWidth < o.minShoulderWidth) issues.push("tooFar");
  if (nose[1] < o.minNoseY || !visible(nose)) issues.push("headCut");
  if (midY > o.maxShoulderY || !visible(ls) || !visible(rs)) issues.push("shouldersHidden");
  if (midX < o.minMidX || midX > o.maxMidX) issues.push("offCentre");

  // the bottom edge is fine: the hand rests below the picture between signs
  const atEdge = (p) => p[0] < o.handEdge || p[0] > 1 - o.handEdge || p[1] < o.handEdge;
  if (frame.hands.some((h) => h?.some(atEdge))) issues.push("handEdge");
  return issues;
}

// Rolling check over the last windowFrames frames, with hysteresis.
// push(frame, size, luma?) returns { ready, ok, issue: {code, message} | null, active: [codes] };
// ready is false until a full window has been seen (nothing is judged before then).
export function createFramingMonitor(options = {}) {
  const o = { ...FRAMING, ...options };
  const history = []; // issue codes per frame
  const active = new Set();
  let lastLuma = null; // brightness is measured only now and then; reuse the latest value

  return {
    push(frame, size, luma = null) {
      if (luma !== null) lastLuma = luma;
      history.push(frameIssues(frame, size, lastLuma, o));
      if (history.length > o.windowFrames) history.shift();

      for (const code of ORDER) {
        const share = history.filter((codes) => codes.includes(code)).length / o.windowFrames;
        if (share >= o.showShare) active.add(code);
        else if (share <= o.hideShare) active.delete(code);
      }
      const codes = ORDER.filter((c) => active.has(c));
      return {
        ready: history.length >= o.windowFrames,
        ok: codes.length === 0,
        issue: FRAMING_ISSUES.find((i) => i.code === codes[0]) ?? null,
        active: codes,
      };
    },
  };
}

// Mean brightness (0-255) of a video frame, measured on a tiny copy so it costs almost nothing.
export function measureLuma(video, canvas) {
  canvas.width = 32;
  canvas.height = 24;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, 32, 24);
  const px = ctx.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  return sum / (px.length / 4);
}
