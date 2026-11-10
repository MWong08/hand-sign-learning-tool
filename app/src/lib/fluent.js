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
import { preprocessFrames } from "./preprocess.js";

export const FLUENT = {
  stride: 2,
  lengths: [10, 14, 18, 24],
  threshold: 0.9,
  minRun: 4,
  maxGapSteps: 1,      // a run survives one step without a confident window
  minHandShare: 0.6,   // a window needs a hand in 60% of its frames
  resetGap: 8,         // hand-less frames after which the same sign may be emitted again
};

const hasHand = (f) => f.hands[0] !== null || f.hands[1] !== null;

// classify(featuresList) -> one probability array per window (same order as labels)
export function createFluentDecoder(width, height, classify, labels, options = {}) {
  const o = { ...FLUENT, ...options };
  const maxLen = Math.max(...o.lengths);
  let buffer = [];     // last maxLen frames
  let count = 0;       // frames seen
  let run = null;      // { k, n, lastStep, best: { prob, frames } }
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
      }
      if (count % o.stride !== 0 || count < Math.min(...o.lengths)) return null;
      step++;

      const windows = [];
      for (const L of o.lengths) {
        if (L > buffer.length) continue;
        const w = buffer.slice(-L);
        if (w.filter(hasHand).length / L < o.minHandShare) continue;
        const x = preprocessFrames(w, width, height);
        if (x) windows.push({ x, frames: w });
      }
      if (windows.length === 0) return null;

      const probs = classify(windows.map((w) => w.x));
      let best = null; // most confident sign over the window lengths
      probs.forEach((p, wi) => {
        for (let k = 0; k < p.length; k++) {
          if (!best || p[k] > best.prob) best = { k, prob: p[k], frames: windows[wi].frames };
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
        return { sign: labels[run.k], prob: run.best.prob, frames: run.best.frames };
      }
      return null;
    },
    reset() {
      buffer = []; count = 0; run = null; lastEmitted = null; handless = 0; step = 0;
    },
  };
}
