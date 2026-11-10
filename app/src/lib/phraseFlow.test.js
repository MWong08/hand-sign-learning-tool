import { describe, expect, it } from "vitest";
import { phraseFlow } from "./phraseFlow.js";

const LABELS = ["HELLO", "MY", "MOM"];
const r = (joined, start, end) => ({ joined, start, end });

describe("phrase flow feedback", () => {
  it("praises a phrase signed in one flow, with its length in seconds", () => {
    const f = phraseFlow([r(null, 10, 25), r("flowing", 27, 40), r("flowing", 41, 55)], LABELS);
    expect(f.title).toContain("Smooth");
    expect(f.smooth).toBe(2);
    expect(f.seconds).toBeCloseTo(3, 5);
  });

  it("names the first place the hand was dropped, before any pause", () => {
    const f = phraseFlow([r(null, 0, 10), r("paused", 20, 30), r("lowered", 50, 60)], LABELS);
    expect(f.title).toBe("Flow: 0 of 2 joins smooth.");
    expect(f.tip).toContain("dropped your hand between “MY” and “MOM”");
  });

  it("names a pause", () => {
    const f = phraseFlow([r(null, 0, 10), r("flowing", 11, 20), r("paused", 30, 40)], LABELS);
    expect(f.title).toBe("Flow: 1 of 2 joins smooth.");
    expect(f.tip).toContain("paused between “MY” and “MOM”");
  });

  it("has nothing to say about a one-sign phrase", () => {
    expect(phraseFlow([r(null, 0, 10)], LABELS)).toBeNull();
  });
});
