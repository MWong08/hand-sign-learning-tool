// Splits a live stream of frames into SIGNS for phrase practice: "HELLO ... MY ... MOM".
// A sign ends when the learner either lowers the hand (as in single-sign practice) or PAUSES:
// holds the hand still for under a second. Each segment is then classified like a single sign.
// (Signs run together with no pause are found by the sliding-window decoder, fluent.js; the
// phrase tracker, phraseTracker.js, runs both.)
//
// "Still" is judged over a WINDOW of the last PAUSE_FRAMES frames: the hand is still if it stays
// close to its average position and shape over that window (its SPREAD). Until 2026-11-11 every
// single frame had to move less than a small threshold, which sat right at MediaPipe's jitter
// floor on a live webcam: holding a hand still, only ~26% of frames passed, so 7 in a row almost
// never happened and learners had to drop the hand out of view to end a sign. Jitter does not
// add up over a window, real movement does, so the spread rule tolerates jitter.
// PAUSE_FRAMES, STILL_WRIST and STILL_SHAPE were calibrated together (model/src/calibrate_pause.py)
// on real held hands recorded through this app's own browser pipeline, against real single-sign
// clips (a still window with movement on both sides would wrongly split a sign): the most held
// hands caught (81%; the misses are hands touching the face, where tracking is unsteady) with at
// most 4% of real signs split. A longer window (11 frames, ~0.73 s) separates a deliberate pause
// from a held handshape inside a sign better than tighter limits do. See DEVLOG 2026-11-11.
// MIN_MOTION and MAX_FRAMES were tuned on phrases built from VALIDATION signers
// (model/src/make_phrase_eval.py --split val); see DEVLOG 2026-10-24.

export const START_FRAMES = 2;    // hand frames in a row before a segment starts
export const END_GAP = 8;         // hand-less frames (~0.5 s) that end a segment (hand lowered)
export const PAUSE_FRAMES = 11;   // window of still frames (~0.73 s) that ends a segment (pause)
export const STILL_WRIST = 0.015; // max wrist distance from its window average (shoulder widths) ...
export const STILL_SHAPE = 0.06;  // ... and max hand-shape distance from the window average (hand sizes)
export const RESUME_FACTOR = 2;   // after a pause, moving this many times the still limits = signing again
export const MIN_MOTION = 0.15;   // a segment needs at least this much movement to count as a sign
export const MAX_FRAMES = 150;    // 10 s safety cap per segment (5 s split some long real clips)
export const PRE_ROLL = 2;        // frames kept from just before a segment starts

const SHAPE_WEIGHT = 0.25; // a hand is roughly 1/4 shoulder width, so shape change counts less

const hasHand = (f) => f.hands[0] !== null || f.hands[1] !== null;
const px = (p, width, height) => [p[0] * width, p[1] * height];

// Movement between two consecutive frames: wrist speed and hand-shape change (pixels, then
// normalised by shoulder width / hand size). Returns null if no hand is in both frames.
// Used to measure how much a segment moved in total (MIN_MOTION).
export function frameMotion(prev, cur, width, height, shoulderWidth) {
  let best = null;
  for (const slot of [0, 1]) {
    const a = prev.hands[slot], b = cur.hands[slot];
    if (!a || !b) continue;
    const [aw, bw] = [px(a[0], width, height), px(b[0], width, height)];
    const handSize = Math.max(Math.hypot(...px(b[9], width, height).map((v, i) => v - bw[i])), 1e-6);
    const wrist = Math.hypot(bw[0] - aw[0], bw[1] - aw[1]) / shoulderWidth;
    let shape = 0;
    for (let j = 1; j < 21; j++) {
      const ra = px(a[j], width, height).map((v, i) => v - aw[i]);
      const rb = px(b[j], width, height).map((v, i) => v - bw[i]);
      shape += Math.hypot(rb[0] - ra[0], rb[1] - ra[1]) / handSize;
    }
    shape /= 20;
    const m = { wrist, shape, total: wrist + SHAPE_WEIGHT * shape };
    if (!best || m.total > best.total) best = m; // the hand that moved more
  }
  return best;
}

// How much the hand wanders over a window of frames: { wrist, shape } spread of the hand that
// spread more (see the header), or null if no hand slot is present in every frame.
// The same measure as model/src/calibrate_pause.py spreads().
export function handSpread(frames, width, height, shoulderWidth) {
  let best = null;
  for (const slot of [0, 1]) {
    if (!frames.every((f) => f.hands[slot])) continue;
    const hs = frames.map((f) => f.hands[slot].map((p) => px(p, width, height)));
    const n = hs.length;
    const meanWrist = [0, 1].map((i) => hs.reduce((s, h) => s + h[0][i], 0) / n);
    const wrist = Math.max(...hs.map((h) => Math.hypot(h[0][0] - meanWrist[0], h[0][1] - meanWrist[1]))) / shoulderWidth;
    const sizes = hs.map((h) => Math.hypot(h[9][0] - h[0][0], h[9][1] - h[0][1])).sort((a, b) => a - b);
    const size = Math.max(sizes[Math.floor(n / 2)], 1e-6); // median hand size
    const rel = hs.map((h) => h.slice(1).map((p) => [(p[0] - h[0][0]) / size, (p[1] - h[0][1]) / size]));
    const meanRel = rel[0].map((_, j) => [0, 1].map((i) => rel.reduce((s, r) => s + r[j][i], 0) / n));
    const shape = Math.max(...rel.map((r) => r.reduce((s, p, j) => s + Math.hypot(p[0] - meanRel[j][0], p[1] - meanRel[j][1]), 0) / 20));
    if (!best || wrist + SHAPE_WEIGHT * shape > best.wrist + SHAPE_WEIGHT * best.shape) best = { wrist, shape };
  }
  return best;
}

function shoulderWidthOf(frame, width, height) {
  if (!frame.pose) return null;
  const [l, r] = [frame.pose[11], frame.pose[12]];
  const w = Math.hypot((l[0] - r[0]) * width, (l[1] - r[1]) * height);
  return w > 1 ? w : null;
}

// options can override the thresholds above (used to tune them on the evaluation phrases)
export function createSegmenter(width, height, options = {}) {
  const { pauseFrames = PAUSE_FRAMES, minMotion = MIN_MOTION, maxFrames = MAX_FRAMES, endGap = END_GAP,
    stillWrist = STILL_WRIST, stillShape = STILL_SHAPE } = options;
  let state = "idle";          // idle | active | paused
  let armed = false;           // true once the hand has been seen down: never start mid-sign
  let recent = [];             // last pauseFrames frames (pre-roll, start and stillness detection)
  let frames = [];             // current segment
  let motion = 0, gap = 0;
  let still = 0;               // latest frames that are still together (0..pauseFrames), for the UI
  let anchor = null;           // the held pause: { frames } to compare new movement against
  let holding = false;         // the last pauseFrames frames are still, whatever the state
  let prev = null;
  let shoulderW = height / 3;  // until the first pose is seen

  const startSegment = () => {
    state = "active";
    frames = recent.slice(-(PRE_ROLL + START_FRAMES));
    motion = 0; gap = 0; still = 0;
  };
  const finish = (reason) => {
    const seg = { frames, reason, motion };
    const ok = motion >= minMotion && frames.filter(hasHand).length >= 4;
    frames = []; motion = 0; gap = 0;
    return ok ? seg : null;
  };
  // still over the last pauseFrames frames, with the limits multiplied by `factor`
  const windowStill = (win, factor = 1) => {
    const s = win.length >= pauseFrames ? handSpread(win, width, height, shoulderW) : null;
    return s !== null && s.wrist < stillWrist * factor && s.shape < stillShape * factor;
  };

  return {
    get state() { return state; },
    // 0..1: how far into a pause the learner is (drawn as a filling ring)
    get stillness() { return state === "active" ? still / pauseFrames : 0; },
    // true while the hand is being held still (a whole still window), in any state
    get holding() { return holding; },

    // Feed one frame; returns a finished segment { frames, reason: "lowered"|"paused"|"max" }
    // or null.
    push(frame) {
      shoulderW = shoulderWidthOf(frame, width, height) ?? shoulderW;
      const m = prev && hasHand(prev) && hasHand(frame) ? frameMotion(prev, frame, width, height, shoulderW) : null;
      prev = frame;
      recent.push(frame);
      if (recent.length > Math.max(pauseFrames, PRE_ROLL + START_FRAMES + 1)) recent.shift();
      const win = recent.slice(-pauseFrames);
      holding = windowStill(win);

      if (state === "idle") {
        if (!hasHand(frame)) armed = true;
        if (!armed) return null;
        if (recent.slice(-START_FRAMES).length === START_FRAMES && recent.slice(-START_FRAMES).every(hasHand)) startSegment();
        return null;
      }

      if (state === "paused") {
        // hand still up and holding: wait for clear movement away from the pause (or for the
        // hand to drop). Comparing with the held pause, with a margin, stops jitter restarting it.
        if (!hasHand(frame)) {
          gap += 1;
          if (gap >= endGap) { state = "idle"; gap = 0; }
        } else if (!windowStill([...anchor.slice(-(pauseFrames - 1)), frame], RESUME_FACTOR)) {
          startSegment();
        }
        return null;
      }

      // active
      frames.push(frame);
      if (m) motion += m.total;
      gap = hasHand(frame) ? 0 : gap + 1;
      // still = how many of the latest frames are still together (a pause = a whole still window)
      still = holding ? pauseFrames : 0;
      for (let k = 2; !holding && k <= pauseFrames && k <= win.length; k++) {
        const s = handSpread(win.slice(-k), width, height, shoulderW);
        if (!s || s.wrist >= stillWrist || s.shape >= stillShape) break;
        still = k;
      }

      if (gap >= endGap) {
        state = "idle";
        return finish("lowered");
      }
      if (holding) {
        if (motion >= minMotion) {
          state = "paused";
          anchor = win;
          return finish("paused");
        }
        // holding still before starting to sign: restart the segment from here
        frames = frames.slice(-PRE_ROLL);
        motion = 0; still = 0;
        return null;
      }
      if (frames.length >= maxFrames) {
        state = "paused";
        anchor = win;
        return finish("max");
      }
      return null;
    },

    // Start a fresh segment from the next frame: another detector (fluent.js) has just found a
    // sign in the current one. The hand stays up, so it's treated like the end of a pause.
    cut() {
      frames = []; motion = 0; still = 0; gap = 0;
      if (state === "active") {
        state = "paused";
        anchor = recent.slice(-pauseFrames);
      }
    },

    reset() {
      state = "idle"; armed = false; recent = []; frames = []; motion = 0; still = 0; gap = 0; prev = null; anchor = null;
    },
  };
}
