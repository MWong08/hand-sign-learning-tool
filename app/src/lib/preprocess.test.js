// Parity test: the browser preprocessing must give the same features as model/src/preprocess.py.
// Fixture: real raw landmark sequences + Python outputs, from model/src/export_parity_fixture.py.
import { describe, expect, it } from "vitest";
import cases from "./__fixtures__/parity.json";
import { preprocessFrames, SEQ_LEN } from "./preprocess.js";

const TOLERANCE = 1e-3; // Python computes in float32, JavaScript in float64

describe("preprocessFrames matches Python preprocess_video", () => {
  it.each(cases.map((c) => [c.source, c.category, c]))("%s (%s)", (_source, _category, c) => {
    const actual = preprocessFrames(c.frames, c.width, c.height);
    if (c.expected === null) {
      expect(actual).toBeNull();
      return;
    }
    expect(actual).not.toBeNull();
    expect(actual.length).toBe(SEQ_LEN);
    let maxDiff = 0;
    actual.forEach((row, t) => row.forEach((v, j) => {
      maxDiff = Math.max(maxDiff, Math.abs(v - c.expected[t][j]));
    }));
    expect(maxDiff).toBeLessThan(TOLERANCE);
  });
});
