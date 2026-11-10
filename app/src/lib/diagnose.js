// Diagnostic feedback (IR FR2): WHICH part of a sign is off and HOW CLOSE the attempt was.
// JavaScript port of model/src/diagnostics.py `diagnose()`; diagnose.test.js checks they agree.
//
// An attempt (24 frames x 64 features, from preprocess.js) is compared with the target sign's
// template, built from the training signers (public/models/templates.json):
//   components: the 5 fingers' hand shape, hand position, and movement
//   deviation:  mean |attempt - template mean| / template std  (z-score; 0 = typical signer)
//   flagged:    deviation above the 95th percentile of real signers (calibrated on validation)
// and each flagged component gets a direction ("straighten", "higher", "bigger", ...).

import { asset } from "./assets.js";

export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];
export const COMPONENTS = [...FINGERS, "position", "movement"];
const LOCATION = [60, 61]; // wrist - shoulder midpoint (y grows downwards)
const TO_FACE = [62, 63];  // wrist - nose
const CLOSENESS_ZERO_AT = 1.25;
const CONTRAST_MIN_GAP = 0.1; // contrast(): ignore parts that fit both signs about equally
const EPS = 1e-3;

const range = (start, n) => Array.from({ length: n }, (_, i) => start + i);
const FINGER_COLS = Object.fromEntries(FINGERS.map((f, i) => [f, range(i * 12, 12)]));
const TIP_COLS = Object.fromEntries(FINGERS.map((f, i) => [f, range(i * 12 + 9, 3)]));

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const norm = (values) => Math.hypot(...values);

let cache = null;
export async function loadTemplates() {
  if (!cache) cache = await fetch(asset("models/templates.json")).then((r) => r.json());
  return cache;
}

// ---------------------------------------------------------------- measures

function movementPath(x) {
  const avg = LOCATION.map((c) => mean(x.map((row) => row[c])));
  return x.map((row) => LOCATION.map((c, k) => row[c] - avg[k]));
}

function measures(x) {
  const m = {};
  for (const f of FINGERS) m[`ext_${f}`] = mean(x.map((row) => norm(TIP_COLS[f].map((c) => row[c]))));
  m.height = mean(x.map((row) => row[LOCATION[1]]));
  m.face_dist = mean(x.map((row) => norm(TO_FACE.map((c) => row[c]))));
  m.path_len = 0;
  for (let i = 1; i < x.length; i++) m.path_len += norm(LOCATION.map((c) => x[i][c] - x[i - 1][c]));
  return m;
}

function deviations(x, t) {
  // mean z-score over every frame and every listed column
  const z = (cols) => mean(x.flatMap((row, i) => cols.map((c) => Math.abs(row[c] - t.mean[i][c]) / (t.std[i][c] + EPS))));
  const dev = {};
  for (const f of FINGERS) dev[f] = z(FINGER_COLS[f]);
  dev.position = z([...LOCATION, ...TO_FACE]);
  const path = movementPath(x);
  dev.movement = mean(path.flatMap((p, i) => p.map((v, k) => Math.abs(v - t.path_mean[i][k]) / (t.path_std[i][k] + EPS))));
  return dev;
}

function closeness(dev, t) {
  const overall = mean(COMPONENTS.map((c) => dev[c]));
  const score = 100 * (1 - (overall - t.overall_p50) / (CLOSENESS_ZERO_AT * t.overall_p95 - t.overall_p50));
  return Math.min(100, Math.max(0, score));
}

// ---------------------------------------------------------------- diagnosis

// which way to change component c of an attempt (measures m) to move towards template t
function hintFor(c, m, t) {
  const tm = t.measures;
  if (FINGERS.includes(c)) return m[`ext_${c}`] < tm[`ext_${c}`].mean ? "straighten" : "bend";
  if (c === "position") {
    const dh = m.height - tm.height.mean;
    const df = m.face_dist - tm.face_dist.mean;
    // report whichever is further off, in units of its own spread across signers
    if (Math.abs(dh) / tm.height.std >= Math.abs(df) / tm.face_dist.std) return dh > 0 ? "higher" : "lower";
    return df > 0 ? "closer_to_face" : "further_from_face";
  }
  return m.path_len < tm.path_len.mean ? "bigger" : "smaller";
}

// x: SEQ_LEN x 64 features; t: the target sign's template
// returns { closeness: 0-100, issues: [{ component, hint, severity }] } (worst issue first)
export function diagnose(x, t) {
  const dev = deviations(x, t);
  const m = measures(x);
  const issues = [];
  for (const c of COMPONENTS) {
    if (dev[c] <= t.thresholds[c]) continue;
    issues.push({ component: c, hint: hintFor(c, m, t), severity: Math.round((dev[c] / t.thresholds[c]) * 1000) / 1000 });
  }
  issues.sort((a, b) => b.severity - a.severity);
  return { closeness: Math.round(closeness(dev, t) * 10) / 10, issues };
}

// When an attempt at the target was read as a look-alike sign: the part of the attempt that fits
// the look-alike better than the target, and which way to change it.
// Each deviation is divided by its component's flag threshold, so parts and signs share one scale;
// gap = target - look-alike, and the part with the largest gap is "what made it look like the other
// sign". null when no part fits the other sign better by at least CONTRAST_MIN_GAP.
// returns { component, hint, gap } or null
export function contrast(x, target, look) {
  const dt = deviations(x, target);
  const dl = deviations(x, look);
  let best = null;
  for (const c of COMPONENTS) {
    const gap = dt[c] / target.thresholds[c] - dl[c] / look.thresholds[c];
    if (!best || gap > best.gap) best = { component: c, gap };
  }
  if (best.gap < CONTRAST_MIN_GAP) return null;
  return { component: best.component, hint: hintFor(best.component, measures(x), target), gap: Math.round(best.gap * 1000) / 1000 };
}

// ---------------------------------------------------------------- learner-facing wording

const FINGER_NAME = { thumb: "thumb", index: "index finger", middle: "middle finger", ring: "ring finger", pinky: "little finger" };

const PART_NAME = { ...FINGER_NAME, position: "where your hand was", movement: "the movement" };

// "mostly your index finger" / "mostly where your hand was"
export function describePart(component) {
  return FINGERS.includes(component) ? `your ${PART_NAME[component]}` : PART_NAME[component];
}

// the things to fix for one analysed attempt, most useful first: the part that made it look like
// another sign (contrast), then the flagged parts, without repeating a part
export function fixesFor(result, limit) {
  const list = result.contrast ? [result.contrast] : [];
  for (const issue of result.issues ?? []) {
    if (!list.some((i) => i.component === issue.component)) list.push(issue);
  }
  return list.slice(0, limit);
}

export function describeIssue({ component, hint }) {
  if (FINGERS.includes(component)) {
    return hint === "straighten" ? `Straighten your ${FINGER_NAME[component]} more.` : `Bend your ${FINGER_NAME[component]} more.`;
  }
  return {
    higher: "Sign a little higher.",
    lower: "Sign a little lower.",
    closer_to_face: "Bring your hand closer to your face.",
    further_from_face: "Keep your hand a bit further from your face.",
    bigger: "Make the movement bigger.",
    smaller: "Make the movement smaller.",
  }[hint];
}
