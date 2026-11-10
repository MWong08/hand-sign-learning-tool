import { describe, expect, it } from "vitest";
import { buildQuiz, scoreQuiz } from "./quiz.js";

// small deterministic random number generator for repeatable tests
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe("quiz", () => {
  const pool = ["hello", "bye", "please", "yes", "no", "mom", "dad"];

  it("picks distinct signs from the pool, at most n", () => {
    const q = buildQuiz(pool, 5, seeded(1));
    expect(q.length).toBe(5);
    expect(new Set(q).size).toBe(5);
    q.forEach((s) => expect(pool).toContain(s));
  });

  it("uses the whole pool when it is smaller than n", () => {
    expect(buildQuiz(["a", "b"], 10).sort()).toEqual(["a", "b"]);
  });

  it("does not modify the pool", () => {
    const copy = [...pool];
    buildQuiz(pool, 3, seeded(2));
    expect(pool).toEqual(copy);
  });

  it("scores answers and lists signs to review", () => {
    const s = scoreQuiz([
      { signId: "hello", verdict: "correct", closeness: 90 },
      { signId: "bye", verdict: "close", closeness: 60 },
      { signId: "yes", verdict: "unclear" },
    ]);
    expect(s).toEqual({ correct: 1, total: 3, averageCloseness: 75, toReview: ["bye", "yes"] });
  });
});
