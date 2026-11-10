// Fluent signing: recognise signs WITHOUT pauses between them, by classifying overlapping
// windows of the live stream (a sliding-window decoder). JavaScript port of the decoder in
// model/src/eval_continuous.py, with the settings chosen there on validation phrases:
// on test-signer phrases joined without pauses it gave a 17.9% word error rate, against 68.1%
// for the pause segmenter (segmenter.js), which needs a pause (DEVLOG 2026-11-08).
//
//   1. Every STRIDE frames, classify the windows ENDING at that frame, one per length in
//      LENGTHS (a sign lasts ~10-24 frames at 15 fps), skipping windows that mostly lack a hand.
//   2. Keep the most confident sign over those windows, if its probability >= THRESHOLD.
//   3. MIN_RUN such steps in a row agreeing on one sign = that sign is recognised (emitted once).
//      A repeat of the sign just emitted is ignored until the hand has been lowered.
//   4. Target spotting (phrase practice, 2026-11-11): when the sign expected next is known
//      (setTarget), it is also watched for on its own, with a lower bar: TARGET_THRESHOLD for
//      TARGET_MIN_RUN steps. The learner can then sign the phrase in one flow; whether the sign
//      was RIGHT is still judged separately (judgeSign.js) on the frames found. Settings chosen
//      on validation phrases by app/scripts/eval_phrase_tracker.mjs (DEVLOG 2026-11-11).
import { preprocessFrames } from "./preprocess.js";

export const FLUENT = {
  stride: 2,
  lengths: [10, 14, 18, 24],
  threshold: 0.9,
  minRun: 4,
  maxGapSteps: 1,      // a run survives one step without a confident window
  minHandShare: 0.6,   // a window needs a hand in 60% of its frames
  resetGap: 8,         // hand-less frames after which the same sign may be emitted again
  targetThreshold: 0.3, // target spotting: probability of the expected sign ...
  targetMinRun: 4,      // ... in this many steps in a row (chosen on val, DEVLOG 2026-11-11)
  // (options may also pass preprocess(frames, width, height): only the evaluation script does,
  //  to use features it has computed in advance)
};

const hasHand = (f) => f.hands[0] !== null || f.hands[1] !== null;

// classify(featuresList, windows) -> one probability array per window (same order as labels);
// windows (the frames of each window) is only passed for caching in the evaluation script.
// Emits { sign, prob, frames, end, reason: "recognised" | "spotted" }; end = frame count at the
// end of the window found.
export function createFluentDecoder(width, height, classify, labels, options = {}) {
  const o = { ...FLUENT, ...options };
  const maxLen = Math.max(...o.lengths);
  let buffer = [];     // last maxLen frames
  let count = 0;       // frames seen
  let run = null;      // { k, n, lastStep, best: { prob, frames } }
  let targetRun = null; // the same for the expected sign (target spotting)
  let target = null;   // index of the expected sign, or null
  let lastEmitted = null;
  let handless = 0;
  let step = 0;

  return {
    // Feed one frame; returns { sign, prob, frames } when a sign is recognised, else null.
    // frames: the most confident window of that sign, for judging it like a single attempt.
    push(frame) {
      buffer.push(frame);
      if (buffer.length > maxLen) buffer.shift();
      count++;
      handless = hasHand(frame) ? 0 : handless + 1;
      if (handless >= o.resetGap) {
        lastEmitted = null;
        run = null;
        targetRun = null;
      }
      if (count % o.stride !== 0 || count < Math.min(...o.lengths)) return null;
      step++;

      const windows = [];
      for (const L of o.lengths) {
        if (L > buffer.length) continue;
        const w = buffer.slice(-L);
        if (w.filter(hasHand).length / L < o.minHandShare) continue;
        const x = (o.preprocess ?? preprocessFrames)(w, width, height);
        if (x) windows.push({ x, frames: w });
      }
      if (windows.length === 0) return null;

      const probs = classify(windows.map((w) => w.x), windows.map((w) => w.frames));

      // 4. target spotting: the expected sign, with its own (lower) bar
      if (target !== null && target !== lastEmitted) {
        let tb = null;
        probs.forEach((p, wi) => {
          if (!tb || p[target] > tb.prob) tb = { k: target, prob: p[target], frames: windows[wi].frames };
        });
        if (tb.prob >= o.targetThreshold) {
          if (targetRun && step - targetRun.lastStep <= o.maxGapSteps + 1) {
            targetRun.n++;
            targetRun.lastStep = step;
            if (tb.prob > targetRun.best.prob) targetRun.best = { ...tb, end: count };
          } else {
            targetRun = { n: 1, lastStep: step, best: { ...tb, end: count } };
          }
          if (targetRun.n >= o.targetMinRun) {
            const found = targetRun.best;
            lastEmitted = target;
            targetRun = null;
            run = null;
            return { sign: labels[target], prob: found.prob, frames: found.frames, end: found.end, reason: "spotted" };
          }
        }
      }

      let best = null; // most confident sign over the window lengths
      probs.forEach((p, wi) => {
        for (let k = 0; k < p.length; k++) {
          if (!best || p[k] > best.prob) best = { k, prob: p[k], frames: windows[wi].frames, end: count };
        }
      });
      if (best.prob < o.threshold) return null;

      if (run && run.k === best.k && step - run.lastStep <= o.maxGapSteps + 1) {
        run.n++;
        run.lastStep = step;
        if (best.prob > run.best.prob) run.best = best;
      } else {
        run = { k: best.k, n: 1, lastStep: step, best, emitted: false };
      }
      if (run.n >= o.minRun && !run.emitted && run.k !== lastEmitted) {
        run.emitted = true;
        lastEmitted = run.k;
        return { sign: labels[run.k], prob: run.best.prob, frames: run.best.frames, end: run.best.end, reason: "recognised" };
      }
      return null;
    },
    // the sign to spot (phrase practice), or null
    setTarget(sign) {
      const k = sign === null ? null : labels.indexOf(sign);
      if (k !== target) targetRun = null;
      target = k === -1 ? null : k;
    },
    // Another detector (the pause segmenter) has just ended a sign: start afresh, and don't
    // emit `sign` (what it was recognised as) again until the hand is lowered.
    cut(sign = null) {
      buffer = []; run = null; targetRun = null;
      lastEmitted = sign === null ? null : labels.indexOf(sign);
    },
    reset() {
      buffer = []; count = 0; run = null; targetRun = null; lastEmitted = null; handless = 0; step = 0;
    },
  };
}
