// Checks the app's fluent-mode decoder (src/lib/fluent.js) against the Python experiment
// (model/src/eval_continuous.py): same test phrases, same model, the app's own code.
// Run from app/:  node scripts/eval_fluent.mjs [continuous|paused|lowered]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tf from "@tensorflow/tfjs";
import { createFluentDecoder } from "../src/lib/fluent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const style = process.argv[2] ?? "continuous";
const modelDir = path.resolve(here, "../public/models/transformer_crop");
const cases = JSON.parse(fs.readFileSync(path.resolve(here, "../../model/data/processed/phrase_eval.json"), "utf8"));
const labels = JSON.parse(fs.readFileSync(path.resolve(here, "../public/models/labels.json"), "utf8"));

const json = JSON.parse(fs.readFileSync(path.join(modelDir, "model.json"), "utf8"));
const buf = Buffer.concat(json.weightsManifest.flatMap((g) => g.paths.map((p) => fs.readFileSync(path.join(modelDir, p)))));
await tf.setBackend("cpu");
const model = await tf.loadGraphModel({ load: async () => ({
  modelTopology: json.modelTopology, format: json.format, weightSpecs: json.weightsManifest.flatMap((g) => g.weights),
  weightData: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), signature: json.signature,
}) });
const classify = (xs) => {
  const flat = tf.tidy(() => model.predict(tf.tensor3d(xs)).dataSync());
  return xs.map((_, i) => flat.subarray(i * labels.length, (i + 1) * labels.length));
};

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

let edits = 0, words = 0, exact = 0;
const t0 = Date.now();
for (const c of cases) {
  const dec = createFluentDecoder(c.width, c.height, classify, labels);
  const out = c[style].map((f) => dec.push(f)).filter(Boolean).map((e) => e.sign);
  const e = editDistance(c.signs, out);
  edits += e; words += c.signs.length; exact += e === 0;
}
console.log(`fluent decoder (JS) on ${style} test phrases: WER ${(edits / words * 100).toFixed(1)}%, ` +
  `exact ${(exact / cases.length * 100).toFixed(1)}% (${cases.length} phrases, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
