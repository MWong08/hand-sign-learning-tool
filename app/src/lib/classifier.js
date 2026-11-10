// Loads the exported TF.js sign classifier (model/src/export_tfjs.py) and runs it on one
// preprocessed sequence (SEQ_LEN x 64).
// Deployed model: transformer_crop, the Transformer also trained on phrase-style cropped clips
// (same single-sign accuracy, more robust on signs cut out of phrases; chosen on validation,
// see DEVLOG 2026-10-24).
import * as tf from "@tensorflow/tfjs";
import { asset } from "./assets.js";

// Sliding-window calls (fluent.js) classify 1-4 windows at a time. On WebGL, TF.js compiles new
// GPU programs for every new input shape, which for this model froze the page for ~2.5 s the first
// time each batch size appeared, long enough to miss a whole sign mid-phrase (found 2026-11-11
// with the browser phrase test). So batches are always padded to BATCH and both shapes used
// (1 and BATCH) are compiled during loading.
export const BATCH = 4;

export async function createClassifier(modelName = "transformer_crop") {
  // WebGL runs on the GPU in the browser; fall back to the plain CPU backend if unavailable
  if (!(await tf.setBackend("webgl"))) await tf.setBackend("cpu");
  await tf.ready();

  const [model, labels] = await Promise.all([
    tf.loadGraphModel(asset(`models/${modelName}/model.json`)),
    fetch(asset("models/labels.json")).then((r) => r.json()),
  ]);
  // warm-up: compile both input shapes now, while the loading screen is showing
  for (const n of [1, BATCH]) tf.tidy(() => model.predict(tf.zeros([n, ...model.inputs[0].shape.slice(1)])).dataSync());

  return {
    labels,
    backend: tf.getBackend(),
    // returns [{ sign, prob }] sorted by probability, highest first
    predict(features) {
      const probs = tf.tidy(() => model.predict(tf.tensor3d([features])).dataSync());
      return labels.map((sign, i) => ({ sign, prob: probs[i] })).sort((a, b) => b.prob - a.prob);
    },
    // several sequences (up to BATCH) in one model call (fluent.js); returns one probability
    // array per sequence. Padded to BATCH with copies of the last one: one shape, no recompiling.
    predictBatch(featuresList) {
      const padded = [...featuresList];
      while (padded.length % BATCH !== 0) padded.push(featuresList.at(-1));
      const flat = tf.tidy(() => model.predict(tf.tensor3d(padded)).dataSync());
      return featuresList.map((_, i) => flat.subarray(i * labels.length, (i + 1) * labels.length));
    },
  };
}
