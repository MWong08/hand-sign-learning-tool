// JavaScript port of model/src/preprocess.py. Must produce the SAME features as the Python
// code, or the model will see different input live than it saw in training.
// preprocess.test.js checks this against outputs exported from Python.
//
// Input: an array of frames, each { hands, pose }:
//   hands[slot][joint][xyz]  slot 0 = MediaPipe "Left", slot 1 = "Right"; null if not detected
//   pose[point][xyzv]        25 upper-body points; null if not detected
// Coordinates are MediaPipe's normalised 0-1 values; width/height are the video frame size.

export const SEQ_LEN = 24;
export const MAX_GAP = 5;
export const CANONICAL_SLOT = 1;
const NOSE = 0, L_SHOULDER = 11, R_SHOULDER = 12;
const WRIST = 0, MIDDLE_MCP = 9;

// left/right pose points swap places when the image is mirrored (same table as Python)
export const POSE_MIRROR = Array.from({ length: 25 }, (_, i) => i);
for (const [a, b] of [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16],
  [17, 18], [19, 20], [21, 22], [23, 24]]) {
  POSE_MIRROR[a] = b;
  POSE_MIRROR[b] = a;
}

// ---------------------------------------------------------------- helpers

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// like numpy.interp: linear between known points, edges copy the nearest known point
function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1;
  while (xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}

const norm = (v) => Math.hypot(...v);

// ---------------------------------------------------------------- step 1

// Main run of frames with a hand: runs separated by gaps of <= MAX_GAP frames are merged,
// and the run with the most hand frames wins. Returns [start, end) or null.
export function trimToActive(handPresent) {
  const idx = handPresent.flatMap((p, i) => (p ? [i] : []));
  if (idx.length === 0) return null;
  const runs = [];
  let start = idx[0], prev = idx[0];
  for (const i of idx.slice(1)) {
    if (i - prev > MAX_GAP + 1) {
      runs.push([start, prev + 1]);
      start = i;
    }
    prev = i;
  }
  runs.push([start, prev + 1]);
  const count = ([a, b]) => handPresent.slice(a, b).filter(Boolean).length;
  return runs.reduce((best, r) => (count(r) > count(best) ? r : best)); // first wins ties, like max()
}

// ---------------------------------------------------------------- step 2

// Fill missing (null) frames by linear interpolation over time; edges copy the nearest
// detected frame. Each frame is points x coordinates (21 x 3 for a hand, 25 x 4 for pose).
export function interpolateMissing(seq) {
  const valid = seq.flatMap((f, i) => (f !== null ? [i] : []));
  if (valid.length === seq.length) return seq;
  const nPoints = seq[valid[0]].length, nCoords = seq[valid[0]][0].length;
  return seq.map((frame, i) => (frame !== null ? frame
    : Array.from({ length: nPoints }, (_, p) => Array.from({ length: nCoords },
      (_, c) => interp(i, valid, valid.map((v) => seq[v][p][c]))))));
}

// Signing hand = the slot detected in more frames (ties -> slot 0, like numpy argmax).
// Mirrors x (and swaps pose left/right points) if it isn't the canonical slot.
export function dominantHand(frames) {
  const counts = [0, 1].map((s) => frames.filter((f) => f.hands[s] !== null).length);
  const slot = counts[1] > counts[0] ? 1 : 0;
  const flip = ([x, ...rest]) => [1 - x, ...rest];

  let hand = frames.map((f) => f.hands[slot]);
  let pose = frames.map((f) => f.pose);
  if (slot !== CANONICAL_SLOT) {
    hand = hand.map((h) => (h === null ? null : h.map(flip)));
    // new point i = flipped old point POSE_MIRROR[i] (same as Python's pose[:, POSE_MIRROR])
    pose = pose.map((p) => (p === null ? null : POSE_MIRROR.map((src) => flip(p[src]))));
  }
  return { hand: interpolateMissing(hand), pose: interpolateMissing(pose) };
}

// ---------------------------------------------------------------- step 3

// Per-frame features (64): hand shape (60), wrist relative to shoulders (2), wrist relative
// to nose (2). Converted to pixels first so different frame shapes don't distort geometry.
export function makeFeatures(hand, pose, width, height) {
  const px = (p) => [p[0] * width, p[1] * height, p[2] * width];
  hand = hand.map((frame) => frame.map(px));
  const xy = (p) => [p[0] * width, p[1] * height];

  const shoulderMid = [0, 1].map((c) => median(pose.map((p) => (xy(p[L_SHOULDER])[c] + xy(p[R_SHOULDER])[c]) / 2)));
  const shoulderW = median(pose.map((p) => {
    const l = xy(p[L_SHOULDER]), r = xy(p[R_SHOULDER]);
    return norm([l[0] - r[0], l[1] - r[1]]);
  }));
  const nose = [0, 1].map((c) => median(pose.map((p) => xy(p[NOSE])[c])));
  const handSize = Math.max(median(hand.map((h) => norm([0, 1, 2].map((c) => h[MIDDLE_MCP][c] - h[WRIST][c])))), 1e-6);

  return hand.map((h) => {
    const w = h[WRIST];
    const shape = h.slice(1).flatMap((j) => [0, 1, 2].map((c) => (j[c] - w[c]) / handSize));
    const location = [0, 1].map((c) => (w[c] - shoulderMid[c]) / shoulderW);
    const toFace = [0, 1].map((c) => (w[c] - nose[c]) / shoulderW);
    return [...shape, ...location, ...toFace];
  });
}

// ---------------------------------------------------------------- step 4

export function resample(features, length = SEQ_LEN) {
  const n = features.length;
  const src = features.map((_, i) => (n === 1 ? 0 : i / (n - 1)));
  const out = [];
  for (let k = 0; k < length; k++) {
    const x = length === 1 ? 0 : k / (length - 1);
    out.push(features[0].map((_, j) => (n === 1 ? features[0][j] : interp(x, src, features.map((f) => f[j])))));
  }
  return out;
}

// ---------------------------------------------------------------- full pipeline

// frames -> SEQ_LEN x 64 array, or null if unusable (no hand, or no shoulders).
export function preprocessFrames(frames, width, height) {
  const present = frames.map((f) => f.hands[0] !== null || f.hands[1] !== null);
  const seg = trimToActive(present);
  if (seg === null) return null;
  const active = frames.slice(seg[0], seg[1]);
  if (active.every((f) => f.pose === null)) return null;
  const { hand, pose } = dominantHand(active);
  const features = resample(makeFeatures(hand, pose, width, height));
  return features.every((row) => row.every(Number.isFinite)) ? features : null;
}
