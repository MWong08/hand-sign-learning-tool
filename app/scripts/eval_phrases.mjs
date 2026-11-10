// End-to-end phrase recognition evaluation, using the app's OWN code (segmenter.js,
// preprocess.js) and the exported TF.js model, on synthetic phrases built from real test-set
// clips (model/src/make_phrase_eval.py).
//
// Metrics, per joining style ("lowered" = hand drops between signs, "paused" = hand stays up
// and holds still, "continuous" = no pause at all; the segmenter is not designed for it):
//   segmentation  share of phrases split into exactly the right number of signs
//   WER           word error rate = (substitutions + deletions + insertions) / signs, the
//                 standard metric for sign-sequence recognition
//   exact         share of phrases recognised completely correctly
//
// Run from app/:  node scripts/eval_phrases.mjs [modelName] [test|val]
// (val phrases are for choosing settings; test phrases give the final reported numbers)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tf from "@tensorflow/tfjs";
import { preprocessFrames } from "../src/lib/preprocess.js";
import { createSegmenter } from "../src/lib/segmenter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelName = process.argv[2] ?? "transformer";
const modelDir = path.resolve(here, "../public/models", modelName);
const split = process.argv[3] ?? "test";
const evalFile = path.resolve(here, `../../model/data/processed/${split === "test" ? "phrase_eval" : `phrase_eval_${split}`}.json`);

function fileHandler(dir) {
  return {
    async load() {
      const json = JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8"));
      const buf = Buffer.concat(json.weightsManifest.flatMap((g) => g.paths.map((p) => fs.readFileSync(path.join(dir, p)))));
      return {
        modelTopology: json.modelTopology, format: json.format, generatedBy: json.generatedBy, convertedBy: json.convertedBy,
        weightSpecs: json.weightsManifest.flatMap((g) => g.weights),
        weightData: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        signature: json.signature, userDefinedMetadata: json.userDefinedMetadata, modelInitializer: json.modelInitializer,
      };
    },
  };
}

// Levenshtein distance between two sequences (substitutions + deletions + insertions)
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

await tf.setBackend("cpu");
const model = await tf.loadGraphModel(fileHandler(modelDir));
const labels = JSON.parse(fs.readFileSync(path.resolve(here, "../public/models/labels.json"), "utf8"));
const cases = JSON.parse(fs.readFileSync(evalFile, "utf8"));

function recognise(frames, width, height) {
  const segmenter = createSegmenter(width, height);
  const out = [];
  for (const f of frames) {
    const seg = segmenter.push(f);
    if (!seg) continue;
    const features = preprocessFrames(seg.frames, width, height);
    if (!features) continue;
    const probs = tf.tidy(() => model.predict(tf.tensor3d([features])).dataSync());
    out.push(labels[probs.indexOf(Math.max(...probs))]);
  }
  return out;
}

const results = {};
for (const style of ["lowered", "paused", "continuous"].filter((s) => s in cases[0])) {
  let rightCount = 0, edits = 0, words = 0, exact = 0;
  const byLength = {};
  for (const c of cases) {
    const predicted = recognise(c[style], c.width, c.height);
    const e = editDistance(c.signs, predicted);
    rightCount += predicted.length === c.signs.length;
    edits += e;
    words += c.signs.length;
    exact += e === 0;
    const L = c.signs.length;
    byLength[L] ??= { phrases: 0, exact: 0 };
    byLength[L].phrases++;
    byLength[L].exact += e === 0;
  }
  results[style] = {
    phrases: cases.length,
    segmentation: +(rightCount / cases.length).toFixed(3),
    wer: +(edits / words).toFixed(3),
    exact: +(exact / cases.length).toFixed(3),
    exactByLength: Object.fromEntries(Object.entries(byLength).map(([L, v]) => [L, +(v.exact / v.phrases).toFixed(3)])),
  };
  console.log(`${modelName} (${split}) | ${style.padEnd(7)} | correct no. of signs ${(results[style].segmentation * 100).toFixed(1)}% | ` +
              `WER ${(results[style].wer * 100).toFixed(1)}% | exact phrase ${(results[style].exact * 100).toFixed(1)}% | ` +
              `exact by length ${JSON.stringify(results[style].exactByLength)}`);
}
const outFile = path.resolve(here, `../../model/artifacts/results/phrase_eval_${modelName}_${split}.json`);
fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
