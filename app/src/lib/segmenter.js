// Splits a live stream of frames into SIGNS for phrase practice: "HELLO ... MY ... MOM".
// A sign ends when the learner either lowers the hand (as in single-sign practice) or PAUSES:
// holds the hand still for about half a second. Each segment is then classified like a single sign.
// This is pause-based segmentation, not continuous recognition: signs run together without
// a pause are out of scope (IR 1.5.2).
//
// "Still" means BOTH the wrist and the hand shape barely move. The still thresholds were
// calibrated on the PopSign training clips (only ~3.6% of real single signs contain a still
// stretch that would wrongly split them; wrist speed alone split 9-40%). PAUSE_FRAMES,
// MIN_MOTION and MAX_FRAMES were then tuned on phrases built from VALIDATION signers
// (model/src/make_phrase_eval.py --split val); see DEVLOG 2026-10-24.

export const START_FRAMES = 2;    // hand frames in a row before a segment starts
export const END_GAP = 8;         // hand-less frames (~0.5 s) that end a segment (hand lowered)
export const PAUSE_FRAMES = 7;    // still frames (~0.47 s) that end a segment (pause)
export const STILL_WRIST = 0.01;  // wrist speed below this (shoulder widths per frame) ...
export const STILL_SHAPE = 0.02;  // ... and hand-shape change below this (hand sizes per frame) = still
export const MIN_MOTION = 0.15;   // a segment needs at least this much movement to count as a sign
export const MAX_FRAMES = 150;    // 10 s safety cap per segment (5 s split some long real clips)
export const PRE_ROLL = 2;        // frames kept from just before a segment starts

const SHAPE_WEIGHT = 0.25; // a hand is roughly 1/4 shoulder width, so shape change counts less

const hasHand = (f) => f.hands[0] !== null || f.hands[1] !== null;

// Movement between two consecutive frames: wrist speed and hand-shape change (pixels, then
// normalised by shoulder width / hand size). Returns null if no hand is in both frames.
export function frameMotion(prev, cur, width, height, shoulderWidth) {
  let best = null;
  for (const slot of [0, 1]) {
    const a = prev.hands[slot], b = cur.hands[slot];
    if (!a || !b) continue;
    const px = (p) => [p[0] * width, p[1] * height];
    const [aw, bw] = [px(a[0]), px(b[0])];
    const handSize = Math.max(Math.hypot(...px(b[9]).map((v, i) => v - bw[i])), 1e-6);
    const wrist = Math.hypot(bw[0] - aw[0], bw[1] - aw[1]) / shoulderWidth;
    let shape = 0;
    for (let j = 1; j < 21; j++) {
      const ra = px(a[j]).map((v, i) => v - aw[i]);
      const rb = px(b[j]).map((v, i) => v - bw[i]);
      shape += Math.hypot(rb[0] - ra[0], rb[1] - ra[1]) / handSize;
    }
    shape /= 20;
    const m = { wrist, shape, total: wrist + SHAPE_WEIGHT * shape };
    if (!best || m.total > best.total) best = m; // the hand that moved more
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
  let recent = [];             // last few frames (pre-roll / start detection)
  let frames = [];             // current segment
  let motion = 0, still = 0, gap = 0;
  let prev = null;
  let shoulderW = height / 3;  // until the first pose is seen

  const startSegment = () => {
    state = "active";
    frames = recent.slice(-(PRE_ROLL + START_FRAMES));
    motion = 0; still = 0; gap = 0;
  };
  const finish = (reason) => {
    const seg = { frames, reason, motion };
    const ok = motion >= minMotion && frames.filter(hasHand).length >= 4;
    frames = []; motion = 0; still = 0; gap = 0;
    return ok ? seg : null;
  };

  return {
    get state() { return state; },

    // Feed one frame; returns a finished segment { frames, reason: "lowered"|"paused"|"max" }
    // or null.
    push(frame) {
      shoulderW = shoulderWidthOf(frame, width, height) ?? shoulderW;
      const m = prev && hasHand(prev) && hasHand(frame) ? frameMotion(prev, frame, width, height, shoulderW) : null;
      const isStill = m !== null && m.wrist < stillWrist && m.shape < stillShape;
      prev = frame;
      recent.push(frame);
      if (recent.length > PRE_ROLL + START_FRAMES + 1) recent.shift();

      if (state === "idle") {
        if (!hasHand(frame)) armed = true;
        if (!armed) return null;
        if (recent.slice(-START_FRAMES).length === START_FRAMES && recent.slice(-START_FRAMES).every(hasHand)) startSegment();
        return null;
      }

      if (state === "paused") {
        // hand still up and holding: wait for movement to resume (or for the hand to drop)
        if (!hasHand(frame)) {
          gap += 1;
          if (gap >= endGap) { state = "idle"; gap = 0; }
        } else if (m && !isStill) {
          startSegment();
        }
        return null;
      }

      // active
      frames.push(frame);
      if (m) motion += m.total;
      gap = hasHand(frame) ? 0 : gap + 1;
      still = isStill ? still + 1 : 0;

      if (gap >= endGap) {
        state = "idle";
        return finish("lowered");
      }
      if (still >= pauseFrames) {
        if (motion >= minMotion) {
          state = "paused";
          return finish("paused");
        }
        // holding still before starting to sign: restart the segment from here
        frames = frames.slice(-PRE_ROLL);
        motion = 0; still = 0;
        return null;
      }
      if (frames.length >= maxFrames) {
        state = "paused";
        return finish("max");
      }
      return null;
    },

    reset() {
      state = "idle"; armed = false; recent = []; frames = []; motion = 0; still = 0; gap = 0; prev = null;
    },
  };
}
