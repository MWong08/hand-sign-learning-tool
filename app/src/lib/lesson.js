// Lessons (supervisor meeting 2, 13 Nov: "repeat each sign in different scenarios, like
// Duolingo"). A unit is split into short lessons of 2-4 signs. A lesson is a sequence of
// exercises in which every new sign comes back several times, in different ways:
//
//   watch       copy the sign with the reference video shown (introduces it)
//   pick-word   a clip plays: which word is it? (no camera; trains recognising the sign)
//   pick-video  a word is shown: which of the clips is it? (no camera)
//   recall      sign it from the word alone; the video is shown only after answering
//   phrase      sign a known phrase that uses the new signs (when one fits)
//
// plus one or two earlier signs to review (weak ones first, lib/review.js). An exercise that was
// not answered correctly comes back once more at the end of the lesson (Lesson.jsx).
// Pure functions (rng injectable), so the plans can be unit-tested.
import { lessonBonus, xpFor } from "./gamify.js";
import { weakSigns } from "./review.js";

export const CAMERA_TYPES = new Set(["watch", "recall", "phrase"]);
export const isPick = (type) => type === "pick-word" || type === "pick-video";
const PICK_OPTIONS = 3;
const REVIEW_SIGNS = 2;

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Split a unit's signs into lessons of about 3 signs: 5 -> 3+2, 6 -> 3+3, 7 -> 4+3, 8 -> 3+3+2.
export function splitLessons(signIds) {
  const n = signIds.length;
  const count = n <= 4 ? 1 : Math.round(n / 3);
  const base = Math.floor(n / count);
  const lessons = [];
  let start = 0;
  for (let k = 0; k < count; k++) {
    const size = base + (k < n % count ? 1 : 0);
    lessons.push(signIds.slice(start, start + size));
    start += size;
  }
  return lessons;
}

// A multiple-choice question about signId, with other signs from `pool` as wrong options,
// preferring signs the learner has already met (`seen`), so a question doesn't use a word that
// hasn't been taught yet.
export function pickExercise(type, signId, pool, rng = Math.random, seen = pool) {
  const met = shuffle(pool.filter((s) => s !== signId && seen.includes(s)), rng);
  const rest = shuffle(pool.filter((s) => s !== signId && !seen.includes(s)), rng);
  const others = [...met, ...rest].slice(0, PICK_OPTIONS - 1);
  if (others.length === 0) return null;
  return { type, signId, options: shuffle([signId, ...others], rng) };
}

// newSigns: the lesson's signs; pool: signs to draw wrong options from (the unit and earlier);
// review: earlier signs to practise again; phrase: a phrase to finish with, or null.
export function buildLesson(newSigns, { pool = newSigns, review = [], phrase = null, rng = Math.random } = {}) {
  const ex = [];
  const choices = [...new Set([...pool, ...newSigns])];
  let variant = 0; // alternate the two kinds of multiple choice
  const seen = pool.filter((s) => !newSigns.includes(s)); // met before this lesson
  const pick = (signId) => {
    const p = pickExercise(variant++ % 2 === 0 ? "pick-word" : "pick-video", signId, choices, rng, seen);
    if (p) ex.push(p);
  };
  // 1. introduce each sign; after each new one, a quick check of the one before
  newSigns.forEach((s, k) => {
    ex.push({ type: "watch", signId: s });
    seen.push(s);
    if (k > 0) pick(newSigns[k - 1]);
  });
  pick(newSigns[newSigns.length - 1]);
  // 2. every new sign again from memory, in a new order
  for (const s of shuffle(newSigns, rng)) ex.push({ type: "recall", signId: s });
  // 3. earlier signs, then the phrase
  for (const s of review.slice(0, REVIEW_SIGNS)) ex.push({ type: "recall", signId: s, review: true });
  if (phrase) ex.push({ type: "phrase", phrase });
  return ex;
}

// Unit review: every sign of the unit from memory, mixed with multiple choice, then a phrase.
export function buildUnitReview(unitSigns, { pool = unitSigns, phrase = null, rng = Math.random } = {}) {
  const ex = [];
  const choices = [...new Set([...pool, ...unitSigns])];
  // after every two signs, a multiple-choice question about the first of them
  const order = shuffle(unitSigns, rng);
  order.forEach((s, k) => {
    ex.push({ type: "recall", signId: s });
    if (k % 2 === 1) {
      const p = pickExercise(k % 4 === 1 ? "pick-word" : "pick-video", order[k - 1], choices, rng);
      if (p) ex.push(p);
    }
  });
  if (phrase) ex.push({ type: "phrase", phrase });
  return ex;
}

// Weak-sign review: watch each weak sign again, check it by multiple choice, then sign it from memory.
export function buildWeakReview(weak, { pool = weak, rng = Math.random } = {}) {
  const ex = [];
  const choices = [...new Set([...pool, ...weak])];
  for (const s of weak) ex.push({ type: "watch", signId: s });
  weak.forEach((s, k) => {
    const p = pickExercise(k % 2 === 0 ? "pick-word" : "pick-video", s, choices, rng);
    if (p) ex.push(p);
  });
  for (const s of shuffle(weak, rng)) ex.push({ type: "recall", signId: s });
  return ex;
}

// The first phrase whose signs are all `known` and which uses at least one of `focus`
// (short phrases first).
export function findPhrase(phrases, known, focus) {
  const k = new Set(known);
  const fits = phrases.filter((p) => p.signs.every((s) => k.has(s)) && p.signs.some((s) => focus.includes(s)));
  fits.sort((a, b) => (a.level ?? 1) - (b.level ?? 1));
  return fits[0] ?? null;
}

// The lessons of every unit, with the signs known by the end of each:
// [{ unitIndex, lessonIndex, key, signs, known }]
export function lessonsOf(vocab, unitIndex) {
  const unit = vocab.units[unitIndex];
  const before = vocab.units.slice(0, unitIndex).flatMap((u) => u.signs.map((s) => s.id));
  const known = [...before];
  return splitLessons(unit.signs.map((s) => s.id)).map((signs, lessonIndex) => {
    known.push(...signs);
    return { unitIndex, lessonIndex, key: `${unit.id}:${lessonIndex + 1}`, signs, known: [...known] };
  });
}

export const unitReviewKey = (unit) => `${unit.id}:review`;

// Stars for a finished lesson, from the share of exercises answered correctly at the first try.
export function lessonStars(firstTryShare) {
  return firstTryShare >= 0.9 ? 3 : firstTryShare >= 0.6 ? 2 : 1;
}

// Best stars per lesson key, from the log of finished lessons [{ key, stars }]
export function bestStars(lessonLog) {
  const best = {};
  for (const l of lessonLog) best[l.key] = Math.max(best[l.key] ?? 0, l.stars ?? 0);
  return best;
}

// The plan for one screen:
//   target { kind: "lesson", unitIndex, lessonIndex } | { kind: "unit-review", unitIndex } | { kind: "review" }
//   attempts: saved attempts (for the signs to review); unlocked: sign ids in unlocked units
// returns { title, key, back, signs, exercises } or null (no such lesson, or nothing to review)
export function planLesson(vocab, target, { attempts = [], unlocked = [], rng = Math.random } = {}) {
  if (target.kind === "review") {
    const weak = weakSigns(attempts, unlocked).map((w) => w.signId);
    if (weak.length === 0) return null;
    return { title: "Practise weak signs", key: "review", back: "#/", signs: weak,
      exercises: buildWeakReview(weak, { pool: unlocked, rng }) };
  }
  const unit = vocab.units[target.unitIndex];
  if (!unit) return null;
  const unitSigns = unit.signs.map((s) => s.id);
  const back = `#/unit/${target.unitIndex}`;
  if (target.kind === "unit-review") {
    const known = vocab.units.slice(0, target.unitIndex + 1).flatMap((u) => u.signs.map((s) => s.id));
    return { title: "Unit review", key: unitReviewKey(unit), back, signs: unitSigns,
      exercises: buildUnitReview(unitSigns, { pool: unitSigns, phrase: findPhrase(vocab.phrases, known, unitSigns), rng }) };
  }
  const lesson = lessonsOf(vocab, target.unitIndex)[target.lessonIndex];
  if (!lesson) return null;
  const earlier = lesson.known.filter((s) => !lesson.signs.includes(s));
  // earlier signs to review: the weakest; otherwise one already practised, so earlier signs
  // still come back now and then
  let review = weakSigns(attempts, earlier, 2).map((w) => w.signId);
  if (review.length === 0) {
    const practised = [...new Set(attempts.map((a) => a.signId))].filter((s) => earlier.includes(s));
    review = shuffle(practised, rng).slice(0, 1);
  }
  return {
    title: `Lesson ${target.lessonIndex + 1}`,
    key: lesson.key,
    back,
    signs: lesson.signs,
    exercises: buildLesson(lesson.signs, {
      pool: [...unitSigns, ...earlier.slice(-6)], review, phrase: findPhrase(vocab.phrases, lesson.known, lesson.signs), rng,
    }),
  };
}

// The end-of-lesson review, from the exercises done (queue, including the repeats added at the
// end) and what happened in each (entries[i] = { tries: [{ verdict, closeness?, issues?, frames?,
// signs? }], skipped }).
// returns { share, stars, perfect, xp, signs: [per sign], phrases: [...], needsWork: [sign ids] }
export function summariseLesson(queue, entries) {
  const firstVerdict = (e) => (e?.skipped && !e.tries.length ? "skipped" : e?.tries[0]?.verdict ?? "none");
  const planned = queue.map((ex, i) => ({ ex, e: entries[i] })).filter(({ ex }) => !ex.retry);
  const right = planned.filter(({ e }) => firstVerdict(e) === "correct").length;
  const share = planned.length ? right / planned.length : 0;
  const perfect = planned.length > 0 && right === planned.length;

  const bySign = new Map();
  const phrases = [];
  let xp = 0;
  queue.forEach((ex, i) => {
    const e = entries[i] ?? { tries: [] };
    for (const t of e.tries) {
      if (ex.type === "phrase") xp += (t.signs ?? []).reduce((n, r) => n + xpFor(r), 0);
      else xp += xpFor({ verdict: t.verdict, exercise: ex.type });
    }
    if (ex.type === "phrase") {
      phrases.push({ phrase: ex.phrase, verdict: e.tries.length ? e.tries[e.tries.length - 1].verdict : "skipped", tries: e.tries.length });
      return;
    }
    if (!bySign.has(ex.signId)) bySign.set(ex.signId, { signId: ex.signId, marks: [], bestCloseness: null, replay: null, tip: null, ok: true });
    const s = bySign.get(ex.signId);
    const final = e.tries.some((t) => t.verdict === "correct") ? "correct" : e.tries[e.tries.length - 1]?.verdict ?? (e.skipped ? "skipped" : "none");
    s.marks.push({ type: ex.type, retry: Boolean(ex.retry), first: firstVerdict(e), final });
    if (final !== "correct") s.ok = false;
    for (const t of e.tries) {
      if (t.closeness !== undefined) s.bestCloseness = Math.max(s.bestCloseness ?? 0, t.closeness);
      // the attempt to learn from: the latest one that went wrong, otherwise the latest one
      if (t.frames && t.verdict !== "unclear") {
        if (t.verdict !== "correct" || !s.replay || s.replay.verdict === "correct") s.replay = t;
        if (t.verdict !== "correct" && t.issues?.length) s.tip = t;
      }
    }
  });
  const signs = [...bySign.values()];
  return {
    share,
    stars: lessonStars(share),
    perfect,
    xp: xp + lessonBonus({ perfect }),
    signs,
    phrases,
    needsWork: signs.filter((s) => !s.ok).map((s) => s.signId),
  };
}
