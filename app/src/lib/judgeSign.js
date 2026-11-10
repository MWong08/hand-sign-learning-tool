// (Named judgeSign.js, not analyse.js: ad blockers' EasyPrivacy list blocks any file called
// "/analyse.js" as an analytics script, which left the app as a blank page.)
// Analyse one recorded sign (from the attempt recorder or the phrase segmenter): preprocess,
// classify, judge against a target sign, and diagnose. Shared by single-sign and phrase practice.
import { contrast, diagnose } from "./diagnose.js";
import { evaluateAttempt } from "./evaluate.js";
import { preprocessFrames } from "./preprocess.js";

// returns { verdict, matchScore, rank, lookedLike, closeness, issues, contrast, top, features } or { verdict: "unclear" }
// (features: the attempt's SEQ_LEN x 64 features, drawn by the ghost-hand comparison;
//  contrast: when it looked like another sign, the part that made it look so - see diagnose.js)
export function analyseSign(frames, size, classifier, templates, target) {
  const features = preprocessFrames(frames, size.width, size.height);
  if (!features) return { verdict: "unclear", target };
  const predictions = classifier.predict(features);
  const outcome = { ...evaluateAttempt(predictions, target), top: predictions[0], features };
  const template = templates?.[target];
  if (!template) return outcome;
  const lookAlike = outcome.lookedLike && templates[outcome.lookedLike];
  return {
    ...outcome,
    ...diagnose(features, template),
    contrast: lookAlike ? contrast(features, template, lookAlike) : null,
  };
}

// classify without a target (free signing): best guess and its probability
export function recogniseSign(frames, size, classifier) {
  const features = preprocessFrames(frames, size.width, size.height);
  return features ? classifier.predict(features)[0] : null;
}
