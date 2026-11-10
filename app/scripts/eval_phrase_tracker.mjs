// Evaluates the phrase tracker (src/lib/phraseTracker.js: pause segmenter + sliding-window
// decoder with target spotting) with the app's own code and TF.js model, on the synthetic
// phrases from model/src/make_phrase_eval.py, in every joining style:
//   lowered (hand dropped between signs), paused (frozen hold), held (hold with REAL recorded
//   webcam jitter), continuous (no pause at all).
//
// Phrase practice (the expected signs are known):
//   accepted   share of signs the learner signed correctly that are judged "correct"
//              (a sign never found counts as not accepted)
//   exact      share of phrases with every sign judged correct
//   false acc. the learner signs a DIFFERENT sign at one position (the expected list is changed
//              there): share judged "correct" anyway. Lower is better.
//   after      in those phrases, share of the LATER signs still judged correct (does one wrong
//              sign throw the rest of the phrase out of step?)
// Free signing (nothing expected): WER of the signs found.
//
// Speed: the sliding windows' probabilities are computed in advance with native TensorFlow
// (model/src/cache_window_probs.py: same preprocessing, same model) and passed to the decoder;
// everything else (pause segments, judging) runs the app's own JS preprocessing and TF.js model.
//
// Run from app/:  python ../model/src/cache_window_probs.py val   (once per phrase set)
//                 node scripts/eval_phrase_tracker.mjs val grid   (choose settings on val)
//                 node scripts/eval_phrase_tracker.mjs test       (final numbers, chosen settings)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tf from "@tensorflow/tfjs";
import { createFluentDecoder, FLUENT } from "../src/lib/fluent.js";
import { evaluateAttempt } from "../src/lib/evaluate.js";
import { analyseSign, recogniseSign } from "../src/lib/judgeSign.js";
import { createPhraseTracker } from "../src/lib/phraseTracker.js";
import { createSegmenter } from "../src/lib/segmenter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const split = process.argv[2] ?? "val";
const grid = process.argv[3] === "grid";
const evalFile = path.resolve(here, `../../model/data/processed/${split === "test" ? "phrase_eval" : `phrase_eval_${split}`}.json`);
const modelDir = path.resolve(here, "../public/models/transformer_crop");
const labels = JSON.parse(fs.readFileSync(path.resolve(here, "../public/models/labels.json"), "utf8"));
const cases = JSON.parse(fs.readFileSync(evalFile, "utf8"));
const STYLES = ["lowered", "paused", "held", "continuous"].filter((s) => s in cases[0]);

const json = JSON.parse(fs.readFileSync(path.join(modelDir, "model.json"), "utf8"));
const buf = Buffer.concat(json.weightsManifest.flatMap((g) => g.paths.map((p) => fs.readFileSync(path.join(modelDir, p)))));
await tf.setBackend("cpu");
const model = await tf.loadGraphModel({ load: async () => ({
  modelTopology: json.modelTopology, format: json.format, weightSpecs: json.weightsManifest.flatMap((g) => g.weights),
  weightData: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), signature: json.signature,
}) });

// every frame gets an id, numbered as in cache_window_probs.py: cases, then styles, then frames
let nextId = 0;
for (const c of cases) for (const s of STYLES) for (const f of c[s]) f.id = nextId++;

// window probabilities computed in advance: probs[(id * LENGTHS + k) * 50 + label]
const npy = fs.readFileSync(path.resolve(here, `../../model/data/processed/window_probs_${split}.npy`));
const headerLen = npy.readUInt16LE(8);
const windowProbs = new Float32Array(npy.buffer.slice(npy.byteOffset + 10 + headerLen, npy.byteOffset + npy.byteLength));
if (windowProbs.length !== nextId * FLUENT.lengths.length * labels.length) throw new Error("window cache does not match the phrases: rebuild it");
const N = labels.length;
const windowKey = (frames) => {
  const k = FLUENT.lengths.indexOf(frames.length);
  if (k < 0) return null;
  const key = frames[0].id * FLUENT.lengths.length + k;
  return Number.isNaN(windowProbs[key * N]) ? null : key;
};
// the decoder's preprocessing returns { key } of the window; its classifier looks the key up
const cachedPreprocess = (frames) => { const key = windowKey(frames); return key === null ? null : { key }; };

// other model calls (pause segments, judging): the app's TF.js model, cached by input features
const featureCache = new Map();
const runModel = (x) => {
  const key = x.map((row) => row.map((v) => v.toFixed(4)).join(",")).join(";");
  if (!featureCache.has(key)) featureCache.set(key, tf.tidy(() => model.predict(tf.tensor3d([x])).dataSync()));
  return featureCache.get(key);
};
const classifier = {
  labels,
  predict(x) {
    const p = runModel(x);
    return labels.map((sign, i) => ({ sign, prob: p[i] })).sort((a, b) => b.prob - a.prob);
  },
  predictBatch(xs) {
    return xs.map(({ key }) => windowProbs.subarray(key * N, key * N + N));
  },
};
// judging a found sign: a sliding window's probabilities are already known; a pause segment
// goes through the app's own analyseSign
function verdict(frames, size, target) {
  const key = windowKey(frames);
  if (key === null) return analyseSign(frames, size, classifier, null, target).verdict;
  const p = windowProbs.subarray(key * N, key * N + N);
  return evaluateAttempt(labels.map((sign, i) => ({ sign, prob: p[i] })).sort((a, b) => b.prob - a.prob), target).verdict;
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// one wrong sign per phrase (fixed by a seeded generator, the same for every setting)
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const swaps = cases.map((c) => {
  const k = Math.floor(rand() * c.signs.length);
  const others = labels.filter((l) => !c.signs.includes(l));
  return { k, sign: others[Math.floor(rand() * others.length)] };
});

// phrase practice: judge each found sign against the expected sign at its position
function practice(c, style, targets, opts) {
  const size = { width: c.width, height: c.height };
  const tracker = createPhraseTracker(c.width, c.height, classifier, targets,
    { ...opts, fluent: { ...opts.fluent, preprocess: cachedPreprocess } });
  const verdicts = [];
  const joined = [];
  for (const f of c[style]) {
    if (verdicts.length >= targets.length) break;
    const found = tracker.push(f);
    if (!found) continue;
    verdicts.push(verdict(found.frames, size, targets[verdicts.length]));
    joined.push(found.joined);
  }
  return { verdicts, joined };
}

function evaluate(opts) {
  const out = {};
  for (const style of STYLES) {
    let signs = 0, accepted = 0, exact = 0, wrong = 0, falseAcc = 0, later = 0, laterOk = 0;
    const joinedCount = {};
    cases.forEach((c, i) => {
      const r = practice(c, style, c.signs, opts);
      const ok = c.signs.map((_, k) => r.verdicts[k] === "correct");
      signs += ok.length;
      accepted += ok.filter(Boolean).length;
      exact += ok.every(Boolean);
      r.joined.slice(1).forEach((j) => (joinedCount[j] = (joinedCount[j] ?? 0) + 1));
      const { k, sign } = swaps[i];
      const targets = c.signs.map((s, j) => (j === k ? sign : s));
      const w = practice(c, style, targets, opts);
      wrong++;
      falseAcc += w.verdicts[k] === "correct";
      for (let j = k + 1; j < c.signs.length; j++) { later++; laterOk += w.verdicts[j] === "correct"; }
    });
    out[style] = { accepted: accepted / signs, exact: exact / cases.length, falseAccept: falseAcc / wrong,
      laterCorrect: later ? laterOk / later : null, joined: joinedCount };
  }
  return out;
}

// free signing: WER of the found signs, tracker vs each detector alone
function free(make) {
  const out = {};
  for (const style of STYLES) {
    let edits = 0, words = 0;
    for (const c of cases) {
      const size = { width: c.width, height: c.height };
      const run = make(c, size);
      const got = c[style].map((f) => run(f)).filter(Boolean);
      edits += editDistance(c.signs, got);
      words += c.signs.length;
    }
    out[style] = edits / words;
  }
  return out;
}
const freeTracker = (c) => {
  const t = createPhraseTracker(c.width, c.height, classifier, null, { fluent: { preprocess: cachedPreprocess } });
  return (f) => t.push(f)?.sign;
};
const freeSegmenter = (c, size) => {
  const s = createSegmenter(c.width, c.height);
  return (f) => { const seg = s.push(f); return seg ? recogniseSign(seg.frames, size, classifier)?.sign : null; };
};
const freeDecoder = (c) => {
  const d = createFluentDecoder(c.width, c.height, classifier.predictBatch, labels, { preprocess: cachedPreprocess });
  return (f) => d.push(f)?.sign;
};

const pct = (x) => (x === null ? "  -  " : `${(x * 100).toFixed(1).padStart(5)}%`);
const show = (name, r) => {
  for (const s of STYLES) {
    const v = r[s];
    console.log(`${name.padEnd(34)} ${s.padEnd(10)} accepted ${pct(v.accepted)}  exact ${pct(v.exact)}  ` +
      `false acc. ${pct(v.falseAccept)}  later ok ${pct(v.laterCorrect)}  joined ${JSON.stringify(v.joined)}`);
  }
};

const t0 = Date.now();
const results = { split, phrases: cases.length, practice: {}, free: {} };
const settings = grid
  ? [{ name: "pause segmenter only (no decoder)", opts: { fluent: { threshold: 2, targetThreshold: 2 } } },
     { name: "no target spotting", opts: { recognise: true, fluent: { targetThreshold: 2 } } },
     ...[0.3, 0.5, 0.7].flatMap((th) => [2, 3, 4].flatMap((run) => [true, false].map((rec) => ({
       name: `target ${th} x${run}${rec ? "" : " (spotting only)"}`, opts: { recognise: rec, fluent: { targetThreshold: th, targetMinRun: run } } }))))]
  : [{ name: "pause segmenter only (no decoder)", opts: { fluent: { threshold: 2, targetThreshold: 2 } } },
     { name: "phrase tracker (chosen: defaults)", opts: {} }];
for (const { name, opts } of settings) {
  const r = evaluate(opts);
  results.practice[name] = r;
  show(name, r);
}
results.free = {
  "pause segmenter": free(freeSegmenter),
  "sliding-window decoder": free(freeDecoder),
  "phrase tracker": free(freeTracker),
};
for (const [name, r] of Object.entries(results.free)) {
  console.log(`free signing WER | ${name.padEnd(24)} ${STYLES.map((s) => `${s} ${pct(r[s])}`).join("  ")}`);
}
console.log(`(${cases.length} ${split} phrases, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
fs.writeFileSync(path.resolve(here, `../../model/artifacts/results/phrase_tracker_${split}${grid ? "_grid" : ""}.json`), JSON.stringify(results, null, 1));
