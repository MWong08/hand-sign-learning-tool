// Review queue ("practise your weak signs"): which signs the learner keeps getting wrong, from
// the saved attempts. Only signed attempts count (not the multiple-choice questions in lessons).

export const RECENT = 5;          // look at each sign's last few signed attempts
export const WEAK_BELOW = 0.6;    // weak: fewer than 60% of those correct...
export const REVIEW_LENGTH = 5;   // signs in one review

// true for an attempt where the learner signed (not a multiple-choice answer)
export const isSigned = (a) => !(a.exercise === "pick-word" || a.exercise === "pick-video");

// attempts: every saved attempt, oldest first; pool: the signs that may be reviewed (unlocked).
// Returns up to n sign ids, weakest first: [{ signId, accuracy, attempts }]
export function weakSigns(attempts, pool, n = REVIEW_LENGTH) {
  const allowed = new Set(pool);
  const bySign = new Map();
  for (const a of attempts) {
    if (!allowed.has(a.signId) || !isSigned(a) || a.verdict === "unclear") continue;
    if (!bySign.has(a.signId)) bySign.set(a.signId, []);
    bySign.get(a.signId).push(a);
  }
  const weak = [];
  for (const [signId, list] of bySign) {
    const recent = list.slice(-RECENT);
    const accuracy = recent.filter((a) => a.verdict === "correct").length / recent.length;
    const lastWrong = recent[recent.length - 1].verdict !== "correct";
    // ...or the last try at it was wrong
    if (accuracy < WEAK_BELOW || lastWrong) {
      weak.push({ signId, accuracy, attempts: list.length, last: recent[recent.length - 1].timestamp ?? 0 });
    }
  }
  weak.sort((a, b) => a.accuracy - b.accuracy || b.last - a.last);
  return weak.slice(0, n).map(({ signId, accuracy, attempts: count }) => ({ signId, accuracy, attempts: count }));
}
