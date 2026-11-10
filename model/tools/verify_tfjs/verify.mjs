// Checks that each exported TF.js model gives the same predictions as the Python model.
//
// For every model in app/public/models/*/ it loads model.json + weights from disk,
// runs the reference samples written by export_tfjs.py (verify/samples.json), and compares
// the class probabilities with the Python outputs.
//
// Run from this folder:  npm run verify
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tf from "@tensorflow/tfjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../../app/public/models");

// tf.loadGraphModel normally fetches over HTTP; this handler reads the same files from disk.
function fileHandler(dir) {
  return {
    async load() {
      const json = JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8"));
      const weightSpecs = json.weightsManifest.flatMap((group) => group.weights);
      const buffers = json.weightsManifest.flatMap((group) =>
        group.paths.map((p) => fs.readFileSync(path.join(dir, p))));
      const all = Buffer.concat(buffers);
      return {
        modelTopology: json.modelTopology,
        weightSpecs,
        weightData: all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength),
        format: json.format,
        generatedBy: json.generatedBy,
        convertedBy: json.convertedBy,
        signature: json.signature,
        userDefinedMetadata: json.userDefinedMetadata,
        modelInitializer: json.modelInitializer,
      };
    },
  };
}

function hasDynamicOps(model) {
  try {
    tf.tidy(() => model.predict(tf.zeros([1, ...model.inputs[0].shape.slice(1)])));
    return false;
  } catch (e) {
    return /dynamic op/.test(e.message);
  }
}

await tf.setBackend("cpu");
const names = fs.readdirSync(modelsDir).filter((n) => fs.existsSync(path.join(modelsDir, n, "model.json")));

for (const name of names) {
  const dir = path.join(modelsDir, name);
  const model = await tf.loadGraphModel(fileHandler(dir));
  const ref = JSON.parse(fs.readFileSync(path.join(dir, "verify", "samples.json"), "utf8"));

  // models with a recurrent loop (LSTM/GRU) contain dynamic ops and need executeAsync()
  const dynamic = hasDynamicOps(model);
  const run = async (x) => {
    const out = dynamic ? await model.executeAsync(x) : model.predict(x);
    const values = await out.array();
    out.dispose();
    return values;
  };
  const input = tf.tensor3d(ref.x);
  let probs;
  try {
    probs = await run(input);
  } catch (e) {
    console.log(`${name}: FAILED to run in TF.js: ${e.message.split(".")[0]}`);
    continue;
  } finally {
    input.dispose();
  }
  let maxDiff = 0, sameTop1 = 0, correct = 0;
  probs.forEach((p, i) => {
    p.forEach((v, j) => { maxDiff = Math.max(maxDiff, Math.abs(v - ref.probs[i][j])); });
    const top = p.indexOf(Math.max(...p));
    const refTop = ref.probs[i].indexOf(Math.max(...ref.probs[i]));
    if (top === refTop) sameTop1++;
    if (top === ref.y[i]) correct++;
  });

  // timing: one sample at a time, as the app will run it
  const one = tf.tensor3d([ref.x[0]]);
  for (let i = 0; i < 5; i++) await run(one); // warm-up
  const t0 = performance.now();
  const runs = 50;
  for (let i = 0; i < runs; i++) await run(one);
  const ms = (performance.now() - t0) / runs;

  console.log(`${name}${dynamic ? " (executeAsync)" : ""}: ${sameTop1}/${probs.length} same top-1 as Python, max |prob diff| = ${maxDiff.toExponential(2)}, ` +
              `${correct}/${probs.length} correct, ${ms.toFixed(1)} ms/prediction (tfjs cpu backend in Node)`);
}
