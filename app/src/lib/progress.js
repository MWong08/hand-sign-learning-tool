// Curriculum rules (IR FR4 "mastery-gated curriculum of progressive units") as pure functions,
// so they can be unit-tested and explained independently of storage (db.js) and the UI.
//
//   sign mastered    MASTERY_STREAK correct attempts in a row (consistency, not one lucky try)
//   unit complete    every sign in the unit mastered
//   unit unlocked    unit 1 always; unit n once unit n-1 is complete
//   phrase unlocked  once every sign in the phrase is mastered (combine signs you already know)
//   unlockAll        a setting that opens everything (for exploring, UAT testers and markers)
//   skipped          items the learner chose to skip ahead to, after a confirmation (skipKey()):
//                    skipping to unit n opens units 1..n; skipping a phrase opens that phrase.
//                    Skipping never marks anything as mastered.

export const MASTERY_STREAK = 2;

export function emptySignRecord(signId) {
  return { signId, attempts: 0, correct: 0, streak: 0, bestCloseness: 0, mastered: false, masteredAt: null, lastPracticed: null };
}

// Returns the sign's updated record after one attempt { verdict, closeness?, timestamp }.
// Mastery is kept once earned (a later miss doesn't take it away).
export function applyAttempt(record, attempt) {
  const correct = attempt.verdict === "correct";
  const streak = correct ? record.streak + 1 : 0;
  const nowMastered = !record.mastered && streak >= MASTERY_STREAK;
  return {
    ...record,
    attempts: record.attempts + 1,
    correct: record.correct + (correct ? 1 : 0),
    streak,
    bestCloseness: Math.max(record.bestCloseness, attempt.closeness ?? 0),
    mastered: record.mastered || nowMastered,
    masteredAt: nowMastered ? attempt.timestamp : record.masteredAt,
    lastPracticed: attempt.timestamp,
  };
}

const isMastered = (records, signId) => Boolean(records[signId]?.mastered);

export function unitStatus(unit, records) {
  const mastered = unit.signs.filter((s) => isMastered(records, s.id)).length;
  return { mastered, total: unit.signs.length, complete: mastered === unit.signs.length };
}

// keys for the skipped list: "unit:<unit id>" or "phrase:<gloss>"
export const skipKey = {
  unit: (unit) => `unit:${unit.id}`,
  phrase: (phrase) => `phrase:${phrase.gloss}`,
};

export function isUnitUnlocked(units, index, records, unlockAll = false, skipped = []) {
  if (unlockAll || index === 0) return true;
  // skipped to this unit or to a later one
  if (units.some((u, k) => k >= index && skipped.includes(skipKey.unit(u)))) return true;
  return unitStatus(units[index - 1], records).complete;
}

export function isPhraseUnlocked(phrase, records, unlockAll = false, skipped = []) {
  return unlockAll || skipped.includes(skipKey.phrase(phrase)) || phrase.signs.every((s) => isMastered(records, s));
}

// The sign to practise next in a unit: the first one not yet mastered (or the first sign).
export function nextSignIndex(unit, records) {
  const i = unit.signs.findIndex((s) => !isMastered(records, s.id));
  return i === -1 ? 0 : i;
}
