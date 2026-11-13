import { describe, expect, it } from "vitest";
import { badgeList, badgeStats, newBadges } from "./badges.js";
import { gameStats, XP, xpFor } from "./gamify.js";
import {
  bestStars, buildLesson, buildUnitReview, buildWeakReview, findPhrase, lessonsOf, lessonStars, pickExercise, planLesson,
  splitLessons, summariseLesson,
} from "./lesson.js";
import { weakSigns } from "./review.js";

// repeatable "random" numbers
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const vocab = {
  units: [
    { id: "u1", title: "One", signs: ["hello", "bye", "please", "thankyou", "yes", "no"].map((id) => ({ id, label: id })) },
    { id: "u2", title: "Two", signs: ["mom", "dad", "boy", "girl", "grandma"].map((id) => ({ id, label: id })) },
  ],
  phrases: [
    { signs: ["thankyou", "bye"], gloss: "THANK-YOU BYE" },
    { signs: ["hello", "mom"], gloss: "HELLO MOM" },
    { signs: ["mom", "dad", "boy", "girl"], gloss: "LONG", level: 2 },
  ],
};

describe("splitting a unit into lessons", () => {
  it("makes lessons of about three signs", () => {
    const sizes = (n) => splitLessons(Array.from({ length: n }, (_, i) => `s${i}`)).map((l) => l.length);
    expect(sizes(3)).toEqual([3]);
    expect(sizes(4)).toEqual([4]);
    expect(sizes(5)).toEqual([3, 2]);
    expect(sizes(6)).toEqual([3, 3]);
    expect(sizes(7)).toEqual([4, 3]);
    expect(sizes(8)).toEqual([3, 3, 2]);
  });

  it("keeps every sign once, in order", () => {
    const signs = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(splitLessons(signs).flat()).toEqual(signs);
  });

  it("knows which signs have been taught by the end of each lesson", () => {
    const lessons = lessonsOf(vocab, 1);
    expect(lessons.map((l) => l.key)).toEqual(["u2:1", "u2:2"]);
    expect(lessons[0].known).toContain("hello"); // earlier unit
    expect(lessons[0].known).not.toContain("girl"); // later lesson
    expect(lessons[1].known).toContain("girl");
  });
});

describe("lesson plans", () => {
  it("brings every new sign back several times, in different exercises", () => {
    const ex = buildLesson(["hello", "bye", "please"], { rng: seeded() });
    for (const s of ["hello", "bye", "please"]) {
      const types = ex.filter((e) => e.signId === s).map((e) => e.type);
      expect(types[0]).toBe("watch"); // introduced first
      expect(types).toContain("recall"); // then signed from memory
      expect(types.some((t) => t.startsWith("pick"))).toBe(true); // and recognised
    }
  });

  it("asks about a sign only after it has been introduced", () => {
    const ex = buildLesson(["hello", "bye", "please"], { rng: seeded(3) });
    const introduced = new Set();
    for (const e of ex) {
      if (e.type === "watch") introduced.add(e.signId);
      else expect(introduced.has(e.signId)).toBe(true);
    }
  });

  it("adds review signs and a phrase at the end", () => {
    const phrase = vocab.phrases[0];
    const ex = buildLesson(["thankyou", "yes", "no"], { review: ["hello"], phrase, rng: seeded() });
    expect(ex[ex.length - 1]).toEqual({ type: "phrase", phrase });
    expect(ex.find((e) => e.signId === "hello")).toEqual({ type: "recall", signId: "hello", review: true });
  });

  it("builds multiple-choice questions with the right answer and different wrong ones", () => {
    const p = pickExercise("pick-word", "bye", ["hello", "bye", "please", "yes"], seeded());
    expect(p.options).toHaveLength(3);
    expect(p.options).toContain("bye");
    expect(new Set(p.options).size).toBe(3);
    expect(pickExercise("pick-word", "bye", ["bye"], seeded())).toBeNull(); // nothing to choose from
  });

  it("prefers wrong options the learner has already met", () => {
    for (let seed = 1; seed < 20; seed++) {
      const p = pickExercise("pick-video", "bye", ["hello", "bye", "please", "yes", "no"], seeded(seed), ["hello", "bye", "please"]);
      expect([...p.options].sort()).toEqual(["bye", "hello", "please"]);
    }
  });

  it("unit and weak-sign reviews sign every sign from memory", () => {
    const unit = ["hello", "bye", "please", "thankyou"];
    const review = buildUnitReview(unit, { rng: seeded() });
    expect(review.filter((e) => e.type === "recall").map((e) => e.signId).sort()).toEqual([...unit].sort());
    const weak = buildWeakReview(["bye", "no"], { pool: unit, rng: seeded() });
    expect(weak.slice(0, 2).map((e) => e.type)).toEqual(["watch", "watch"]);
    expect(weak.filter((e) => e.type === "recall")).toHaveLength(2);
  });

  it("finds a phrase made only of known signs that uses a new one", () => {
    expect(findPhrase(vocab.phrases, ["hello", "bye", "please"], ["hello"])).toBeNull();
    expect(findPhrase(vocab.phrases, ["hello", "bye", "please", "thankyou"], ["thankyou"]).gloss).toBe("THANK-YOU BYE");
  });

  it("plans a lesson, a unit review and a weak-sign review from a route", () => {
    const lesson = planLesson(vocab, { kind: "lesson", unitIndex: 0, lessonIndex: 1 }, { rng: seeded() });
    expect(lesson.key).toBe("u1:2");
    expect(lesson.signs).toEqual(["thankyou", "yes", "no"]);
    expect(lesson.exercises.at(-1).type).toBe("phrase"); // THANK-YOU BYE fits
    expect(planLesson(vocab, { kind: "unit-review", unitIndex: 1 }, { rng: seeded() }).key).toBe("u2:review");
    expect(planLesson(vocab, { kind: "lesson", unitIndex: 0, lessonIndex: 9 })).toBeNull();
    expect(planLesson(vocab, { kind: "review" }, { attempts: [], unlocked: ["hello"] })).toBeNull(); // nothing weak
  });
});

describe("weak signs", () => {
  const a = (signId, verdict, t, extra = {}) => ({ signId, verdict, timestamp: t, ...extra });

  it("finds signs mostly wrong lately, or wrong the last time, weakest first", () => {
    const attempts = [
      a("hello", "correct", 1), a("hello", "correct", 2),
      a("bye", "incorrect", 3), a("bye", "incorrect", 4), a("bye", "correct", 5),
      a("please", "correct", 6), a("please", "close", 7),
    ];
    expect(weakSigns(attempts, ["hello", "bye", "please"]).map((w) => w.signId)).toEqual(["bye", "please"]);
  });

  it("ignores multiple-choice answers, unclear attempts and locked signs", () => {
    const attempts = [a("hello", "incorrect", 1, { exercise: "pick-word" }), a("bye", "unclear", 2), a("mom", "incorrect", 3)];
    expect(weakSigns(attempts, ["hello", "bye"])).toEqual([]);
  });
});

describe("lesson results", () => {
  const queue = [
    { type: "watch", signId: "hello" },
    { type: "pick-word", signId: "hello", options: ["hello", "bye", "please"] },
    { type: "recall", signId: "hello" },
    { type: "recall", signId: "hello", retry: true },
  ];
  const frames = [{ hands: [[[0, 0]], null], snap: Promise.resolve(null) }];
  const entries = [
    { tries: [{ verdict: "correct", closeness: 80, frames }] },
    { tries: [{ verdict: "incorrect", chosen: "bye" }] },
    { tries: [{ verdict: "close", closeness: 50, issues: [{ component: "index", hint: "straighten" }], frames }] },
    { tries: [{ verdict: "correct", closeness: 70, frames }] },
  ];

  it("scores answers right at the first try, ignoring the repeats", () => {
    const s = summariseLesson(queue, entries);
    expect(s.share).toBeCloseTo(1 / 3);
    expect(s.stars).toBe(1);
    expect(s.perfect).toBe(false);
    expect(s.xp).toBe(XP.correct + 0 + XP.close + XP.correct + XP.lesson);
  });

  it("collects each sign's results, best closeness and the attempt to learn from", () => {
    const [hello] = summariseLesson(queue, entries).signs;
    expect(hello.marks.map((m) => m.final)).toEqual(["correct", "incorrect", "close", "correct"]);
    expect(hello.bestCloseness).toBe(80);
    expect(hello.replay.verdict).toBe("close"); // the one that went wrong
    expect(hello.tip.issues[0].component).toBe("index");
    expect(hello.ok).toBe(false);
  });

  it("gives stars for the share right first time, and keeps the best per lesson", () => {
    expect([lessonStars(1), lessonStars(0.9), lessonStars(0.7), lessonStars(0.2)]).toEqual([3, 3, 2, 1]);
    expect(bestStars([{ key: "a", stars: 1 }, { key: "a", stars: 3 }, { key: "a", stars: 2 }, { key: "b", stars: 2 }])).toEqual({ a: 3, b: 2 });
  });
});

describe("gamification", () => {
  const NOW = new Date(2026, 10, 13, 15, 0).getTime();
  const DAY = 86400000;

  it("gives a little XP for a right multiple-choice answer, none for a wrong one", () => {
    expect(xpFor({ verdict: "correct", exercise: "pick-word" })).toBe(XP.pick);
    expect(xpFor({ verdict: "incorrect", exercise: "pick-video" })).toBe(0);
    expect(xpFor({ verdict: "incorrect", exercise: "recall" })).toBe(XP.incorrect);
  });

  it("adds lesson bonuses and tracks the longest streak and goal days", () => {
    const attempts = [5, 4, 3, 1, 0].map((d) => ({ verdict: "correct", timestamp: NOW - d * DAY }));
    const g = gameStats(attempts, {}, NOW, [{ key: "u1:1", at: NOW, perfect: true }]);
    expect(g.xp).toBe(5 * XP.correct + XP.lesson + XP.perfect);
    expect(g.todayXp).toBe(XP.correct + XP.lesson + XP.perfect);
    expect(g.streak).toBe(2);
    expect(g.bestStreak).toBe(3);
    expect(g.goalDays).toBe(0);
  });

  it("awards badges from what is saved, and spots the new ones", () => {
    const game = { goalDays: 0, bestStreak: 1 };
    const before = badgeList(badgeStats(vocab, [], {}, [], game));
    expect(before.every((b) => !b.earned)).toBe(true);
    const records = Object.fromEntries(vocab.units[0].signs.map((s) => [s.id, { mastered: true }]));
    const after = badgeList(badgeStats(vocab, [{ signId: "hello", verdict: "correct" }], records,
      [{ key: "u1:1", perfect: true }, { key: "phrase:THANK-YOU BYE", perfect: true }], game));
    expect(newBadges(before, after).map((b) => b.id)).toEqual(["first-sign", "first-lesson", "perfect", "mastered-5", "unit", "phrase"]);
  });
});
