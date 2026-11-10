// Turns the model's predictions for one attempt into practice feedback for a TARGET sign
// (IR FR1: "feedback on whether a performed sign matches the selected target sign").
//
// Verdicts:
//   correct    the target is the model's top prediction, OR it is in the top 3 with a probability
//              of at least TARGET_RATIO x the top one (see below)
//   close      the target is in the top 3 (the model's top-3 test accuracy is ~96.5%, so the
//              right answer is nearly always here when the sign is roughly right)
//   incorrect  otherwise
//
// TARGET_RATIO: in practice we know which sign the learner is TRYING to make, so a near tie with a
// look-alike is given to the target. 0.74 is the loosest value that lets at most 1 percentage point
// more wrong signs through on the validation signers (model/src/eval_target_verdict.py). On the
// test signers: correct attempts accepted 90.9% -> 91.3%, wrong signs accepted 9.1% -> 10.1%.
//
// matchScore is the model's probability for the target sign (0-100). It's an interim
// "how close" measure; the diagnostic, per-component feedback (IR FR2) builds on top of it.

export const CLOSE_RANK = 3;
export const TARGET_RATIO = 0.74;

// predictions: [{ sign, prob }] sorted highest first (from classifier.predict)
export function evaluateAttempt(predictions, target) {
  const rank = predictions.findIndex((p) => p.sign === target);
  const targetProb = rank >= 0 ? predictions[rank].prob : 0;
  const inTop = rank >= 0 && rank < CLOSE_RANK;
  const verdict = rank === 0 || (inTop && targetProb >= TARGET_RATIO * predictions[0].prob)
    ? "correct" : inTop ? "close" : "incorrect";
  return {
    target,
    verdict,
    matchScore: Math.round(targetProb * 100),
    rank: rank + 1,
    // what the attempt looked like instead (only when it wasn't accepted as the target)
    lookedLike: verdict === "correct" ? null : predictions[0].sign,
  };
}
