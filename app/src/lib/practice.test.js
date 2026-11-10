import { describe, expect, it } from "vitest";
import { createAttemptRecorder, END_GAP, MAX_FRAMES, PRE_ROLL, START_FRAMES } from "./attempt.js";
import { evaluateAttempt } from "./evaluate.js";

const HAND = [[0, 0, 0]];
const withHand = () => ({ hands: [null, HAND], pose: null });
const noHand = () => ({ hands: [null, null], pose: null });

// feed a pattern like "..HHHH.." (H = hand, . = no hand); returns the events
function feed(recorder, pattern) {
  pattern = "." + pattern; // every session starts with the hand down (the recorder arms on it)
  return [...pattern].map((c) => recorder.push(c === "H" ? withHand() : noHand())).filter(Boolean);
}

describe("attempt recorder", () => {
  it("ignores a single-frame hand flicker", () => {
    const r = createAttemptRecorder();
    expect(feed(r, ".H.H.")).toEqual([]);
    expect(r.state).toBe("waiting");
  });

  it("starts after START_FRAMES hand frames and ends after END_GAP hand-less frames", () => {
    const r = createAttemptRecorder();
    const events = feed(r, "..." + "H".repeat(10) + ".".repeat(END_GAP));
    expect(events[0]).toBe("started");
    const done = events[1];
    // pre-roll (up to PRE_ROLL) + start frames + rest of the sign + trailing gap
    expect(done.frames.length).toBe(Math.min(3, PRE_ROLL) + 10 + END_GAP);
    expect(r.state).toBe("waiting");
  });

  it("never starts mid-sign: waits until the hand has been seen down", () => {
    const r = createAttemptRecorder();
    const midSign = [..."H".repeat(10)].map(() => r.push(withHand())).filter(Boolean);
    expect(midSign).toEqual([]);
    expect(r.state).toBe("waiting");
    const after = [..."." + "HHH"].map((c) => r.push(c === "H" ? withHand() : noHand())).filter(Boolean);
    expect(after).toEqual(["started"]);
  });

  it("does not end on a short blur gap mid-sign", () => {
    const r = createAttemptRecorder();
    const events = feed(r, "HHHHH" + ".".repeat(END_GAP - 1) + "HHHH");
    expect(events).toEqual(["started"]);
    expect(r.state).toBe("signing");
  });

  it("caps an attempt at MAX_FRAMES", () => {
    const r = createAttemptRecorder();
    const events = feed(r, "H".repeat(MAX_FRAMES + 10));
    const done = events.find((e) => e.frames);
    expect(done.frames.length).toBe(MAX_FRAMES);
  });

  it("can record several attempts in a row", () => {
    const r = createAttemptRecorder();
    const one = "H".repeat(START_FRAMES + 5) + ".".repeat(END_GAP);
    const done = feed(r, one + one).filter((e) => e.frames);
    expect(done.length).toBe(2);
  });
});

describe("evaluateAttempt", () => {
  const preds = [{ sign: "mom", prob: 0.7 }, { sign: "dad", prob: 0.2 }, { sign: "think", prob: 0.06 },
    { sign: "hello", prob: 0.04 }];

  it("is correct when the target is the top prediction", () => {
    expect(evaluateAttempt(preds, "mom")).toEqual(
      { target: "mom", verdict: "correct", matchScore: 70, rank: 1, lookedLike: null });
  });

  it("is close when the target is in the top 3", () => {
    const r = evaluateAttempt(preds, "think");
    expect(r.verdict).toBe("close");
    expect(r.rank).toBe(3);
    expect(r.lookedLike).toBe("mom");
  });

  it("gives a near tie with a look-alike to the target (TARGET_RATIO)", () => {
    const tie = [{ sign: "listen", prob: 0.5 }, { sign: "hello", prob: 0.4 }, { sign: "drink", prob: 0.1 }];
    expect(evaluateAttempt(tie, "hello")).toMatchObject({ verdict: "correct", rank: 2, lookedLike: null });
    // 0.1 is far below 0.74 x 0.5, so drink stays "close"
    expect(evaluateAttempt(tie, "drink")).toMatchObject({ verdict: "close", lookedLike: "listen" });
  });

  it("is incorrect otherwise, and says what it looked like", () => {
    const r = evaluateAttempt(preds, "hello");
    expect(r.verdict).toBe("incorrect");
    expect(r.matchScore).toBe(4);
    expect(r.lookedLike).toBe("mom");
  });
});
