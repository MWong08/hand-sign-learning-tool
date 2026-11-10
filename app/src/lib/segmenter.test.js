import { describe, expect, it } from "vitest";
import { createSegmenter, END_GAP, frameMotion, handSpread, PAUSE_FRAMES } from "./segmenter.js";

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
// a held hand with tracking jitter: every landmark shifts by up to `amount` (0-1 coordinates)
// in a fixed pseudo-random pattern, as MediaPipe's landmarks do on a live webcam
const jitter = (h, i, amount) => h.map((p, j) => [p[0] + amount * Math.sin(i * 7.1 + j * 1.3), p[1] + amount * Math.cos(i * 5.3 + j * 2.1), 0]);
// (the test hand is small, ~14 px, so 0.0005 is ~0.3 px: ~0.04 hand sizes of shape change per frame,
// twice the old per-frame limit)
const jittery = (n, amount = 0.0005, x = 0.4) => Array.from({ length: n }, (_, i) => frame(jitter(hand(x, 0.5), i, amount)));

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

describe("handSpread", () => {
  it("is zero for a frozen hand and grows with jitter, without adding up over frames", () => {
    const frozen = handSpread(holding(7), W, H, 192);
    expect(frozen.wrist).toBeCloseTo(0, 9);
    expect(frozen.shape).toBeCloseTo(0, 9);
    const a = handSpread(jittery(7), W, H, 192), b = handSpread(jittery(30), W, H, 192);
    expect(a.shape).toBeGreaterThan(0);
    expect(b.shape).toBeLessThan(a.shape * 2); // 4x the frames, not 4x the spread
  });

  it("needs the same hand in every frame", () => {
    expect(handSpread([...holding(3), noHand(), ...holding(3)], W, H, 192)).toBeNull();
  });
});

describe("segmenter", () => {
  it("splits on a pause even when the held hand jitters (live webcam)", () => {
    // jitter on every landmark: per frame this is more hand-shape change than the old per-frame
    // rule allowed, so it never saw a pause
    const old = frameMotion(jittery(2)[0], jittery(2)[1], W, H, 192);
    expect(old.shape).toBeGreaterThan(0.02);
    const segs = run([...lowered(3), ...moving(10), ...jittery(PAUSE_FRAMES + 2), ...moving(10, 3), ...lowered(END_GAP)]);
    expect(segs.map((s) => s.reason)).toEqual(["paused", "lowered"]);
  });

  it("does not restart after a pause on jitter alone, only on clear movement", () => {
    const s = createSegmenter(W, H);
    const segs = [noHand(), ...moving(10), ...jittery(30)].map((f) => s.push(f)).filter(Boolean);
    expect(segs.length).toBe(1);
    expect(s.state).toBe("paused");
    moving(3).forEach((f) => s.push(f));
    expect(s.state).toBe("active");
  });

  it("reports stillness filling up during a pause", () => {
    const s = createSegmenter(W, H);
    [noHand(), ...moving(10)].forEach((f) => s.push(f));
    expect(s.stillness).toBe(0);
    holding(4).forEach((f) => s.push(f));
    expect(s.stillness).toBeGreaterThan(0);
    expect(s.stillness).toBeLessThan(1);
  });

  it("cut() starts a fresh segment: the next one holds only what comes after", () => {
    const s = createSegmenter(W, H);
    [noHand(), ...moving(10)].forEach((f) => s.push(f));
    s.cut();
    const segs = [...moving(10, 5), ...lowered(END_GAP)].map((f) => s.push(f)).filter(Boolean);
    expect(segs.length).toBe(1);
    expect(segs[0].frames.length).toBeLessThan(10 + END_GAP + 5);
  });

  it("splits two signs separated by a pause (hand kept up)", () => {
    const segs = run([...lowered(3), ...moving(10), ...holding(PAUSE_FRAMES + 2, 0.4), ...moving(10, 3), ...lowered(END_GAP)]);
    expect(segs.map((s) => s.reason)).toEqual(["paused", "lowered"]);
  });

  it("splits two signs separated by lowering the hand", () => {
    const segs = run([...moving(10), ...lowered(END_GAP), ...moving(10), ...lowered(END_GAP)]);
    expect(segs.map((s) => s.reason)).toEqual(["lowered", "lowered"]);
  });

  it("does not split on a short still moment inside a sign", () => {
    const segs = run([...moving(8), ...holding(PAUSE_FRAMES - 3, 0.54), ...moving(8, 7), ...lowered(END_GAP)]);
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
