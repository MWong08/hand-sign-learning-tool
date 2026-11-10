import "fake-indexeddb/auto"; // an in-memory IndexedDB, so db.js can be tested in Node
import { beforeEach, describe, expect, it } from "vitest";
import { getAllSignProgress, getAttempts, getSetting, recordAttempt, resetProgress, setSetting } from "./db.js";
import {
  applyAttempt, emptySignRecord, isPhraseUnlocked, isUnitUnlocked, MASTERY_STREAK, nextSignIndex, skipKey, unitStatus,
} from "./progress.js";

const units = [
  { id: "u1", signs: [{ id: "hello" }, { id: "bye" }] },
  { id: "u2", signs: [{ id: "mom" }, { id: "dad" }] },
];
const mastered = (...ids) => Object.fromEntries(ids.map((id) => [id, { ...emptySignRecord(id), mastered: true }]));

describe("mastery rules", () => {
  it(`masters a sign after ${MASTERY_STREAK} correct attempts in a row`, () => {
    let r = emptySignRecord("hello");
    r = applyAttempt(r, { verdict: "correct", closeness: 80, timestamp: 1 });
    expect(r.mastered).toBe(false);
    r = applyAttempt(r, { verdict: "correct", closeness: 90, timestamp: 2 });
    expect(r).toMatchObject({ mastered: true, masteredAt: 2, attempts: 2, correct: 2, bestCloseness: 90 });
  });

  it("resets the streak on a miss, and keeps mastery once earned", () => {
    let r = emptySignRecord("hello");
    for (const v of ["correct", "close", "correct"]) r = applyAttempt(r, { verdict: v, timestamp: 1 });
    expect(r.mastered).toBe(false);
    r = applyAttempt(r, { verdict: "correct", timestamp: 2 });
    expect(r.mastered).toBe(true);
    r = applyAttempt(r, { verdict: "incorrect", timestamp: 3 });
    expect(r).toMatchObject({ mastered: true, streak: 0 });
  });

  it("unlocks a unit only when the previous unit is complete", () => {
    expect(isUnitUnlocked(units, 0, {})).toBe(true);
    expect(isUnitUnlocked(units, 1, mastered("hello"))).toBe(false);
    expect(isUnitUnlocked(units, 1, mastered("hello", "bye"))).toBe(true);
    expect(isUnitUnlocked(units, 1, {}, true)).toBe(true); // unlockAll
    expect(unitStatus(units[0], mastered("hello"))).toEqual({ mastered: 1, total: 2, complete: false });
  });

  it("unlocks a phrase when all its signs are mastered", () => {
    const phrase = { signs: ["hello", "mom"] };
    expect(isPhraseUnlocked(phrase, mastered("hello"))).toBe(false);
    expect(isPhraseUnlocked(phrase, mastered("hello", "mom"))).toBe(true);
  });

  it("opens a skipped-to unit and every unit before it, but not later ones", () => {
    const three = [...units, { id: "u3", signs: [{ id: "red" }] }];
    const skipped = [skipKey.unit(three[2])];
    expect([0, 1, 2].map((i) => isUnitUnlocked(three, i, {}, false, skipped))).toEqual([true, true, true]);
    expect(isUnitUnlocked(three, 2, {}, false, [skipKey.unit(three[1])])).toBe(false);
    expect(unitStatus(three[1], {})).toMatchObject({ mastered: 0 }); // skipping masters nothing
  });

  it("opens a skipped phrase only", () => {
    const a = { signs: ["hello", "mom"], gloss: "HELLO MOM" };
    const b = { signs: ["bye"], gloss: "BYE" };
    expect(isPhraseUnlocked(a, {}, false, [skipKey.phrase(a)])).toBe(true);
    expect(isPhraseUnlocked(b, {}, false, [skipKey.phrase(a)])).toBe(false);
  });

  it("suggests the first sign not yet mastered", () => {
    expect(nextSignIndex(units[0], mastered("hello"))).toBe(1);
    expect(nextSignIndex(units[0], mastered("hello", "bye"))).toBe(0);
  });
});

describe("IndexedDB storage", () => {
  beforeEach(() => resetProgress());

  it("records attempts and keeps per-sign progress", async () => {
    const first = await recordAttempt({ signId: "hello", mode: "practice", verdict: "correct", closeness: 70, issues: [] });
    expect(first.newlyMastered).toBe(false);
    const { record: r, newlyMastered } = await recordAttempt({ signId: "hello", mode: "practice", verdict: "correct", closeness: 85,
      issues: [{ component: "index", hint: "straighten", severity: 1.4 }] });
    expect(r.mastered).toBe(true);
    expect(newlyMastered).toBe(true);
    const all = await getAllSignProgress();
    expect(all.hello).toMatchObject({ attempts: 2, correct: 2, bestCloseness: 85, mastered: true });
    const history = await getAttempts("hello");
    expect(history.length).toBe(2);
    expect(history[1].issues).toEqual([{ component: "index", hint: "straighten" }]); // severity not stored
  });

  it("stores settings and can reset progress", async () => {
    await setSetting("unlockAll", true);
    expect(await getSetting("unlockAll", false)).toBe(true);
    await recordAttempt({ signId: "bye", mode: "practice", verdict: "close", closeness: 40 });
    await resetProgress();
    expect(await getAllSignProgress()).toEqual({});
    expect(await getSetting("unlockAll", false)).toBe(true); // settings survive a progress reset
  });
});
