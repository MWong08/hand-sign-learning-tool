// Parity test: diagnose.js must give the same diagnosis as model/src/diagnostics.py.
// Fixture (real test-set samples, half judged against their own sign and half against another
// sign) and templates come from `python src/diagnostics.py`.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import cases from "./__fixtures__/diagnostics.json";
import contrastCases from "./__fixtures__/contrast.json";
import { contrast, describeIssue, describePart, diagnose, fixesFor } from "./diagnose.js";

const templates = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/models/templates.json"), "utf8"));

describe("diagnose matches Python", () => {
  it.each(cases.map((c, i) => [i, c.target, c]))("case %i (target %s)", (_i, _target, c) => {
    const actual = diagnose(c.x, templates[c.target]);
    expect(Math.abs(actual.closeness - c.expected.closeness)).toBeLessThanOrEqual(0.1);
    expect(actual.issues.map((i) => [i.component, i.hint])).toEqual(c.expected.issues.map((i) => [i.component, i.hint]));
    actual.issues.forEach((issue, k) => expect(Math.abs(issue.severity - c.expected.issues[k].severity)).toBeLessThan(1e-2));
  });

  it("has learner-facing wording for every possible hint", () => {
    const hints = [["index", "straighten"], ["thumb", "bend"], ["position", "higher"], ["position", "lower"],
      ["position", "closer_to_face"], ["position", "further_from_face"], ["movement", "bigger"], ["movement", "smaller"]];
    hints.forEach(([component, hint]) => expect(describeIssue({ component, hint })).toMatch(/\.$/));
  });
});

// Fixture from `python src/eval_target_verdict.py`: test-set clips judged against the model's 2nd
// guess as the target, with its 1st guess as the look-alike.
describe("contrast matches Python", () => {
  it.each(contrastCases.map((c, i) => [i, c.target, c.look, c]))("case %i (%s read as %s)", (_i, _t, _l, c) => {
    const actual = contrast(c.x, templates[c.target], templates[c.look]);
    if (c.expected === null) return expect(actual).toBeNull();
    expect(actual.component).toBe(c.expected.component);
    expect(actual.hint).toBe(c.expected.hint);
    expect(Math.abs(actual.gap - c.expected.gap)).toBeLessThan(1e-2);
  });

  it("has a name for every part", () => {
    ["thumb", "index", "middle", "ring", "pinky", "position", "movement"].forEach((c) => expect(describePart(c)).toBeTruthy());
  });
});

describe("fixesFor", () => {
  const contrastFix = { component: "index", hint: "straighten", gap: 0.8 };
  const issues = [{ component: "index", hint: "straighten", severity: 2 }, { component: "movement", hint: "bigger", severity: 1.5 }];

  it("puts the look-alike part first and does not repeat a part", () => {
    expect(fixesFor({ contrast: contrastFix, issues }, 2).map((i) => i.component)).toEqual(["index", "movement"]);
  });

  it("falls back to the flagged parts, and copes with neither", () => {
    expect(fixesFor({ contrast: null, issues }, 1)).toEqual([issues[0]]);
    expect(fixesFor({}, 2)).toEqual([]);
  });
});
