import { describe, expect, it, vi } from "vitest";

// As in fluent.test.js, the classifier "sees" whatever sign the frames are tagged with; the
// segmenter sees real hand geometry, so frames carry both.
vi.mock("./preprocess.js", () => ({ preprocessFrames: (w) => w.filter((f) => f.tag).at(-1)?.tag ?? null }));
const { createPhraseTracker } = await import("./phraseTracker.js");
const { END_GAP, PAUSE_FRAMES } = await import("./segmenter.js");

const LABELS = ["hello", "mom", "dad", "cat", "dog", "home"];
const POSE = Array.from({ length: 25 }, (_, i) => (i === 11 ? [0.65, 0.8, 0, 1] : i === 12 ? [0.35, 0.8, 0, 1] : [0.5, 0.4, 0, 1]));
const hand = (x) => Array.from({ length: 21 }, (_, j) => [x + ((j % 5) - 2) * 0.02, 0.5 - 0.03 * Math.ceil(j / 5), 0]);
const signing = (tag, n) => Array.from({ length: n }, (_, i) => ({ hands: [null, hand(0.4 + 0.02 * (i % 10))], pose: POSE, tag }));
const holding = (tag, n) => Array.from({ length: n }, () => ({ hands: [null, hand(0.4)], pose: POSE, tag }));
const lowered = (n) => Array.from({ length: n }, () => ({ hands: [null, null], pose: POSE, tag: null }));

function classifier(conf) {
  const probs = (tag) => LABELS.map((l) => (l === tag ? conf : (1 - conf) / (LABELS.length - 1)));
  return {
    labels: LABELS,
    predict: (tag) => LABELS.map((sign, i) => ({ sign, prob: probs(tag)[i] })).sort((a, b) => b.prob - a.prob),
    predictBatch: (xs) => xs.map(probs),
  };
}
const run = (frames, targets, conf = 0.95) => {
  const t = createPhraseTracker(640, 480, classifier(conf), targets);
  return frames.map((f) => t.push(f)).filter(Boolean);
};

describe("phrase tracker", () => {
  it("finds signs joined straight into each other (no pause, no lowering)", () => {
    const found = run([...lowered(3), ...signing("hello", 24), ...signing("mom", 24), ...signing("dad", 24)], ["hello", "mom", "dad"]);
    expect(found.map((f) => f.sign)).toEqual(["hello", "mom", "dad"]);
    expect(found.map((f) => f.joined)).toEqual([null, "flowing", "flowing"]);
  });

  it("finds signs separated by a pause, even when the classifier isn't confident", () => {
    const frames = [...lowered(3), ...signing("hello", 12), ...holding("hello", PAUSE_FRAMES + 2), ...signing("mom", 12), ...lowered(END_GAP)];
    const found = run(frames, ["hello", "mom"], 0.25);
    expect(found.map((f) => [f.sign, f.reason])).toEqual([["hello", "paused"], ["mom", "lowered"]]);
    expect(found[1].joined).toBe("paused");
  });

  it("reports a lowered hand between signs", () => {
    const frames = [...lowered(3), ...signing("hello", 12), ...lowered(END_GAP + 2), ...signing("mom", 12), ...lowered(END_GAP)];
    const found = run(frames, ["hello", "mom"], 0.25);
    expect(found.map((f) => f.joined)).toEqual([null, "lowered"]);
  });

  it("does not find a sign twice when a pause follows a sign already found while moving", () => {
    const frames = [...lowered(3), ...signing("hello", 24), ...holding("hello", PAUSE_FRAMES + 4), ...lowered(END_GAP)];
    expect(run(frames, ["hello", "mom"]).map((f) => f.sign)).toEqual(["hello"]);
  });

  it("never starts mid-sign: nothing is found until the hand has been seen down", () => {
    expect(run([...signing("hello", 24), ...signing("mom", 24)], ["hello", "mom"])).toEqual([]);
  });
});

describe("phrase tracker: wrong signs", () => {
  it("only spots the expected sign; a wrong sign is ended by a pause and judged then", () => {
    const frames = [...lowered(3), ...signing("dad", 24)];
    const t = createPhraseTracker(640, 480, classifier(0.95), ["hello", "mom"]);
    expect(frames.map((f) => t.push(f)).filter(Boolean)).toEqual([]);
    expect(t.waitingSeconds).toBeGreaterThan(1); // the page shows a hint after a while
    const found = holding("dad", PAUSE_FRAMES + 2).map((f) => t.push(f)).filter(Boolean);
    expect(found.map((f) => [f.sign, f.reason])).toEqual([["dad", "paused"]]);
    expect(t.waitingSeconds).toBeLessThan(0.5); // reset when the sign was found
  });
});
