import { describe, expect, it } from "vitest";
import { attemptsToCsv, summarise } from "./history.js";

const attempts = [
  { timestamp: Date.UTC(2026, 9, 24, 10), mode: "practice", signId: "hello", verdict: "correct", closeness: 91.26, issues: [] },
  { timestamp: Date.UTC(2026, 9, 24, 11), mode: "phrase", signId: "mom", phrase: "HELLO MY MOM", verdict: "close", closeness: 60,
    issues: [{ component: "index", hint: "straighten" }, { component: "position", hint: "higher" }], framing: ["tooFar"] },
  { timestamp: Date.UTC(2026, 9, 25, 9), mode: "quiz", signId: "red", verdict: "unclear" },
];

describe("practice history", () => {
  it("exports attempts as CSV with a header row", () => {
    const lines = attemptsToCsv(attempts).split("\n");
    expect(lines[0]).toBe("timestamp,date,mode,sign,phrase,joined,verdict,closeness,issues,framing");
    expect(lines[1]).toBe(`${attempts[0].timestamp},2026-10-24T10:00:00.000Z,practice,hello,,,correct,91.3,,`);
    expect(lines[2].endsWith(",close,60,index:straighten; position:higher,tooFar")).toBe(true);
    expect(lines.length).toBe(4);
  });

  it("quotes cells containing commas or quotes", () => {
    const csv = attemptsToCsv([{ timestamp: 0, mode: "phrase", signId: "x", phrase: 'A, "B"', verdict: "correct" }]);
    expect(csv.split("\n")[1]).toContain('"A, ""B"""');
  });

  it("summarises accuracy over judged attempts only", () => {
    const s = summarise(attempts, { hello: { mastered: true }, mom: { mastered: false } });
    expect(s).toEqual({ attempts: 3, accuracy: 50, averageCloseness: 76, mastered: 1, daysPractised: 2 });
  });
});
