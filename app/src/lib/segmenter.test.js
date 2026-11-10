import { describe, expect, it } from "vitest";
import { createSegmenter, END_GAP, frameMotion, PAUSE_FRAMES } from "./segmenter.js";

const W = 640, H = 480;
// shoulders 0.30 apart at 640 px -> shoulder width 192 px
const POSE = Array.from({ length: 25 }, (_, i) => (i === 11 ? [0.65, 0.8, 0, 1] : i === 12 ? [0.35, 0.8, 0, 1] : [0.5, 0.4, 0, 1]));

// a hand with its wrist at (x, y); `curl` moves the fingertips (changes the hand shape only)
function hand(x, y, curl = 0) {
  return Array.from({ length: 21 }, (_, j) => {
    if (j === 0) return [x, y, 0];
    const finger = Math.floor((j - 1) / 4), joint = (j - 1) % 4;
    const reach = joint === 3 ? 1 - curl : 1;
    return [x + (finger - 2) * 0.02, y - 0.03 * (joint + 1) * reach, 0];
  });
}
const frame = (h) => ({ hands: [null, h], pose: POSE });
const noHand = () => ({ hands: [null, null], pose: POSE });

// helpers producing frame sequences
const moving = (n, start = 0) => Array.from({ length: n }, (_, i) => frame(hand(0.4 + 0.02 * ((start + i) % 10), 0.5)));
const holding = (n, x = 0.4) => Array.from({ length: n }, () => frame(hand(x, 0.5)));
const lowered = (n) => Array.from({ length: n }, noHand);

function run(frames) {
  const s = createSegmenter(W, H);
  frames = [noHand(), ...frames]; // sessions start with the hand down (the segmenter arms on it)
  return frames.map((f) => s.push(f)).filter(Boolean);
}

describe("frameMotion", () => {
  it("measures wrist movement in shoulder widths", () => {
    const m = frameMotion(frame(hand(0.40, 0.5)), frame(hand(0.43, 0.5)), W, H, 192);
    expect(m.wrist).toBeCloseTo((0.03 * 640) / 192, 5);
  });

  it("sees hand-shape change even when the wrist is still", () => {
    const m = frameMotion(frame(hand(0.4, 0.5, 0)), frame(hand(0.4, 0.5, 0.5)), W, H, 192);
    expect(m.wrist).toBe(0);
    expect(m.shape).toBeGreaterThan(0.02);
  });
});

describe("segmenter", () => {
  it("splits two signs separated by a pause (hand kept up)", () => {
    const segs = run([...lowered(3), ...moving(10), ...holding(PAUSE_FRAMES + 2, 0.4), ...moving(10, 3), ...lowered(END_GAP)]);
    expect(segs.map((s) => s.reason)).toEqual(["paused", "lowered"]);
  });

  it("splits two signs separated by lowering the hand", () => {
    const segs = run([...moving(10), ...lowered(END_GAP), ...moving(10), ...lowered(END_GAP)]);
    expect(segs.map((s) => s.reason)).toEqual(["lowered", "lowered"]);
  });

  it("does not split on a short still moment inside a sign", () => {
    const segs = run([...moving(8), ...holding(PAUSE_FRAMES - 2, 0.54), ...moving(8, 7), ...lowered(END_GAP)]);
    expect(segs.length).toBe(1);
  });

  it("never starts mid-sign: ignores movement until the hand has been seen down", () => {
    const s = createSegmenter(W, H);
    const segs = [...moving(12), ...lowered(END_GAP)].map((f) => s.push(f)).filter(Boolean);
    expect(segs).toEqual([]);
  });

  it("ignores a raised hand that never moves", () => {
    expect(run([...holding(20), ...lowered(END_GAP)])).toEqual([]);
  });

  it("does not count holding still before signing as a sign", () => {
    const segs = run([...holding(12), ...moving(10), ...lowered(END_GAP)]);
    expect(segs.length).toBe(1);
    expect(segs[0].frames.length).toBeLessThan(12 + 10 + END_GAP);
  });
});
