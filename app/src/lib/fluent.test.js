import { describe, expect, it, vi } from "vitest";

// The decoder's logic is tested with a fake classifier that "sees" whatever sign the frames are
// tagged with; preprocessing is replaced by passing the tag through.
vi.mock("./preprocess.js", () => ({ preprocessFrames: (w) => w.at(-1).tag ?? null }));
const { createFluentDecoder, FLUENT } = await import("./fluent.js");

const LABELS = ["hello", "mom", "dad"];
const HAND = [[0, 0, 0]];
const fr = (tag) => ({ hands: [null, tag === null ? null : HAND], pose: null, tag });
const classify = (conf) => (xs) => xs.map((tag) => LABELS.map((l) => (l === tag ? conf : (1 - conf) / 2)));

function run(tags, conf = 0.95) {
  const dec = createFluentDecoder(640, 480, classify(conf), LABELS);
  return tags.map((t) => dec.push(fr(t))).filter(Boolean).map((e) => e.sign);
}
const repeat = (tag, n) => Array(n).fill(tag);

describe("fluent decoder", () => {
  it("recognises signs joined without any pause", () => {
    expect(run([...repeat("hello", 20), ...repeat("mom", 20), ...repeat("dad", 20)])).toEqual(["hello", "mom", "dad"]);
  });

  it("needs MIN_RUN confident steps: a brief flicker is not a sign", () => {
    const flicker = repeat("mom", FLUENT.stride * (FLUENT.minRun - 1));
    expect(run([...repeat("hello", 20), ...flicker, ...repeat("hello", 4)])).toEqual(["hello"]);
  });

  it("ignores unconfident windows", () => {
    expect(run(repeat("hello", 40), 0.6)).toEqual([]);
  });

  it("emits a held sign once, and again only after the hand is lowered", () => {
    expect(run(repeat("hello", 60))).toEqual(["hello"]);
    expect(run([...repeat("hello", 20), ...repeat(null, FLUENT.resetGap + 2), ...repeat("hello", 20)])).toEqual(["hello", "hello"]);
  });

  it("returns the most confident window's frames for judging the sign", () => {
    const dec = createFluentDecoder(640, 480, classify(0.95), LABELS);
    const event = repeat("mom", 30).map((t) => dec.push(fr(t))).find(Boolean);
    expect(event.sign).toBe("mom");
    expect(event.frames.length).toBeGreaterThanOrEqual(Math.min(...FLUENT.lengths));
  });
});
