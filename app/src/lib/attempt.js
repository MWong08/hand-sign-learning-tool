// Splits the live frame stream into practice attempts: one attempt = the learner raising a
// hand, signing, and lowering it again. Pure logic (no camera), so it can be unit-tested.
//
//   (not armed until a hand-less frame is seen, so an attempt never starts mid-sign, e.g. when
//    the camera starts while the hand is already up)
//   waiting --(hand seen in START_FRAMES frames in a row)--> signing
//   signing --(no hand for END_GAP frames, or MAX_FRAMES reached)--> attempt complete
//
// END_GAP is larger than preprocess.js's MAX_GAP (5), so a few blurred frames mid-sign don't
// end the attempt early, but lowering the hand for ~0.5 s does.

export const START_FRAMES = 2;  // consecutive hand frames before an attempt starts (ignores flickers)
export const END_GAP = 8;       // hand-less frames (~0.5 s at 15 fps) that end an attempt
export const MAX_FRAMES = 75;   // 5 s cap, in case the hand never leaves the frame
export const PRE_ROLL = 3;      // frames kept from before the start, so the sign's beginning isn't cut

const hasHand = (frame) => frame.hands[0] !== null || frame.hands[1] !== null;

export function createAttemptRecorder() {
  let state = "waiting";
  let armed = false; // becomes true once the hand has been seen down (out of view)
  let recent = [];   // last few frames while waiting (pre-roll + start detection)
  let frames = [];   // frames of the current attempt
  let gap = 0;

  return {
    get state() {
      return state;
    },

    // Feed one frame. Returns null normally, "started" when an attempt begins, or
    // { frames } when an attempt is complete.
    push(frame) {
      if (state === "waiting") {
        if (!hasHand(frame)) armed = true;
        if (!armed) return null;
        recent.push(frame);
        if (recent.length > PRE_ROLL + START_FRAMES) recent.shift();
        const tail = recent.slice(-START_FRAMES);
        if (tail.length === START_FRAMES && tail.every(hasHand)) {
          state = "signing";
          frames = [...recent];
          gap = 0;
          return "started";
        }
        return null;
      }

      frames.push(frame);
      gap = hasHand(frame) ? 0 : gap + 1;
      if (gap >= END_GAP || frames.length >= MAX_FRAMES) {
        const done = { frames };
        // ready for the next attempt; stays armed, since the hand has just been lowered
        state = "waiting";
        recent = [];
        frames = [];
        gap = 0;
        return done;
      }
      return null;
    },

    reset() {
      state = "waiting";
      armed = false;
      recent = [];
      frames = [];
      gap = 0;
    },
  };
}
