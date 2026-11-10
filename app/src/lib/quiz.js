// Quiz mode (IR FR5 "quiz-style practice"): random signs from the units the learner has
// unlocked, shown as a WORD only. The reference clip is revealed after the attempt, so the
// learner has to recall the sign rather than copy it.

export const QUIZ_LENGTH = 10;

// Pick up to `n` different signs at random from `pool` (Fisher-Yates shuffle).
// rng is injectable so tests are repeatable.
export function buildQuiz(pool, n = QUIZ_LENGTH, rng = Math.random) {
  const signs = [...pool];
  for (let i = signs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [signs[i], signs[j]] = [signs[j], signs[i]];
  }
  return signs.slice(0, Math.min(n, signs.length));
}

// Summary of finished answers [{ signId, verdict, closeness }]
export function scoreQuiz(answers) {
  const correct = answers.filter((a) => a.verdict === "correct").length;
  const scored = answers.filter((a) => a.closeness !== undefined);
  return {
    correct,
    total: answers.length,
    averageCloseness: scored.length ? Math.round(scored.reduce((s, a) => s + a.closeness, 0) / scored.length) : 0,
    toReview: answers.filter((a) => a.verdict !== "correct").map((a) => a.signId),
  };
}
