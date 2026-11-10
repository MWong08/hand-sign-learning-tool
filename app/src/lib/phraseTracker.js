// Phrase tracker (2026-11-11): finds the signs of a phrase however the learner joins them, by
// running two detectors side by side on the same frames and taking whichever finds a sign first:
//   - the sliding-window decoder (fluent.js) spots the NEXT EXPECTED sign while the hand keeps
//     moving, so the phrase can be signed in one flow;
//   - the pause segmenter (segmenter.js): a sign also ends when the hand pauses or is lowered,
//     which is how a WRONG sign gets judged (the decoder only looks for the expected one).
// When one of them finds a sign, the other is told to start afresh, so a sign isn't found twice.
// This replaced the "pause" / "fluent" mode switch: the learner no longer has to choose.
// Chosen on validation phrases (app/scripts/eval_phrase_tracker.mjs, DEVLOG 2026-11-11): letting
// the decoder also accept any other confident sign ("recognise") inserted extra signs at the
// joins and cost ~10 points of correct signs accepted, so in phrase practice it is off.
//
// It also records how each sign was joined to the one before (for phrase-level feedback):
//   "flowing"  straight into the next sign      "paused"  held still in between
//   "lowered"  hand dropped out of view in between
import { createFluentDecoder } from "./fluent.js";
import { recogniseSign } from "./judgeSign.js";
import { createSegmenter, END_GAP, PAUSE_FRAMES } from "./segmenter.js";
// (events are timed when they are complete: a pause when its still window ends, a lowering when
// the hand has been gone for END_GAP frames, so they fall after the previous sign's end)

const hasHand = (f) => f.hands[0] !== null || f.hands[1] !== null;
// A pause segment that starts right where the decoder found a sign and is shorter than this is
// the rest of that sign, not a new one (signs last ~10-24 frames, median 18: preprocess.py)
export const MIN_SIGN_FRAMES = 10;

// classifier: { predict, predictBatch, labels } (classifier.js)
// targets: the phrase's expected signs, or null for free signing
// options: { recognise: also accept any confident sign from the decoder (default: only when
//              there are no targets), fluent: decoder settings for tuning (fluent.js FLUENT) }
export function createPhraseTracker(width, height, classifier, targets = null, options = {}) {
  const { recognise = targets === null, fluent = {} } = options;
  const size = { width, height };
  const segmenter = createSegmenter(width, height);
  const decoder = createFluentDecoder(width, height, classifier.predictBatch, classifier.labels, fluent);
  let count = 0;          // frames seen
  let found = 0;          // signs found
  let last = null;        // the previous sign found: { sign, end, reason, at: frame count when found }
  let handless = 0;
  let waiting = 0;        // frames with a hand since the last sign was found (for a coach hint)
  let armed = false;      // never start mid-sign: wait until the hand has been seen down once
  let lowerings = [], pauses = []; // frame counts when the hand was lowered / held still

  const emit = (frames, sign, start, end, reason) => {
    // how this sign was joined to the previous one: what happened between the two
    const between = (events) => events.some((t) => t > last.end && t <= start);
    const joined = last === null ? null
      : last.reason === "lowered" || between(lowerings) ? "lowered"
      : last.reason === "paused" || between(pauses) ? "paused" : "flowing";
    const gapSeconds = last === null ? null : Math.max(0, start - last.end) / 15;
    last = { sign, end, reason, at: count };
    lowerings = lowerings.filter((t) => t > end);
    pauses = pauses.filter((t) => t > end);
    found++;
    waiting = 0;
    return { frames, sign, reason, joined, gapSeconds, start, end };
  };

  return {
    get state() { return segmenter.state; },
    get stillness() { return segmenter.stillness; },
    get found() { return found; },
    // seconds of signing since the last sign was found: a long wait suggests a wrong sign,
    // which only a pause or a lowered hand will end (see the header)
    get waitingSeconds() { return waiting / 15; },

    // Feed one frame; returns a found sign { frames, sign, reason, joined, gapSeconds, start, end }
    // or null. sign: what the classifier thinks it was (the caller judges it against the target).
    push(frame) {
      count++;
      handless = hasHand(frame) ? 0 : handless + 1;
      if (!hasHand(frame)) armed = true;
      if (armed && hasHand(frame)) waiting++;
      if (handless === END_GAP) lowerings.push(count);
      if (targets) decoder.setTarget(targets[found] ?? null);

      const seg = segmenter.push(frame);
      if (segmenter.holding) pauses.push(count);
      const dec = armed ? decoder.push(frame) : null;

      if (seg) {
        const guess = recogniseSign(seg.frames, size, classifier);
        const sign = guess?.sign ?? null;
        decoder.cut(sign);
        const trailing = seg.reason === "paused" ? PAUSE_FRAMES : seg.reason === "lowered" ? END_GAP : 0;
        const start = count - seg.frames.length + 1, end = count - trailing;
        // the tail of a sign the decoder already found, ended by a pause or lowered hand: not a
        // new sign. Either it still looks like that sign, or it began at that moment and is too
        // short to be a whole sign.
        const afterDecoder = last && last.reason !== "paused" && last.reason !== "lowered";
        if (afterDecoder && (sign === last.sign || (start <= last.at + 3 && end - start + 1 < MIN_SIGN_FRAMES))) return null;
        return emit(seg.frames, sign, start, end, seg.reason);
      }
      if (dec && (dec.reason === "spotted" || recognise)) {
        segmenter.cut();
        return emit(dec.frames, dec.sign, dec.end - dec.frames.length + 1, dec.end, dec.reason);
      }
      return null;
    },
  };
}
