// Loads the exported TF.js sign classifier (model/src/export_tfjs.py) and runs it on one
// preprocessed sequence (SEQ_LEN x 64).
// Deployed model: transformer_crop, the Transformer also trained on phrase-style cropped clips
// (same single-sign accuracy, more robust on signs cut out of phrases; chosen on validation,
// see DEVLOG 2026-10-24).
import * as tf from "@tensorflow/tfjs";
import { asset } from "./assets.js";

export async function createClassifier(modelName = "transformer_crop") {
  // WebGL runs on the GPU in the browser; fall back to the plain CPU backend if unavailable
  if (!(await tf.setBackend("webgl"))) await tf.setBackend("cpu");
  await tf.ready();

  const [model, labels] = await Promise.all([
    tf.loadGraphModel(asset(`models/${modelName}/model.json`)),
    fetch(asset("models/labels.json")).then((r) => r.json()),
  ]);
  tf.tidy(() => model.predict(tf.zeros([1, ...model.inputs[0].shape.slice(1)]))); // warm-up

  return {
    labels,
    backend: tf.getBackend(),
    // returns [{ sign, prob }] sorted by probability, highest first
    predict(features) {
      const probs = tf.tidy(() => model.predict(tf.tensor3d([features])).dataSync());
      return labels.map((sign, i) => ({ sign, prob: probs[i] })).sort((a, b) => b.prob - a.prob);
    },
    // several sequences in one model call (fluent mode); returns one probability array per sequence
    predictBatch(featuresList) {
      const flat = tf.tidy(() => model.predict(tf.tensor3d(featuresList)).dataSync());
      return featuresList.map((_, i) => flat.subarray(i * labels.length, (i + 1) * labels.length));
    },
  };
}
