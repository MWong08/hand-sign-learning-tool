// Badges (gamification, supervisor meeting 2): milestones computed from what is already saved
// (attempts, sign records, finished lessons and phrases, game stats), so nothing extra is stored.

export const BADGES = [
  { id: "first-sign", icon: "✋", name: "First sign", desc: "Sign a word correctly", test: (s) => s.correct >= 1 },
  { id: "first-lesson", icon: "📘", name: "First lesson", desc: "Finish a lesson", test: (s) => s.lessons >= 1 },
  { id: "perfect", icon: "💯", name: "Perfect lesson", desc: "Finish a lesson with every answer right first time", test: (s) => s.perfectLessons >= 1 },
  { id: "mastered-5", icon: "⭐", name: "Rising star", desc: "Master 5 signs", test: (s) => s.mastered >= 5 },
  { id: "unit", icon: "🏆", name: "Unit champion", desc: "Master every sign in a unit", test: (s) => s.unitsComplete >= 1 },
  { id: "phrase", icon: "💬", name: "Phrase maker", desc: "Sign a whole phrase correctly", test: (s) => s.perfectPhrases >= 1 },
  { id: "goal", icon: "🎯", name: "Goal getter", desc: "Reach the daily XP goal", test: (s) => s.goalDays >= 1 },
  { id: "streak-3", icon: "🔥", name: "On fire", desc: "Practise 3 days in a row", test: (s) => s.bestStreak >= 3 },
  { id: "mastered-25", icon: "🌟", name: "Halfway there", desc: "Master 25 signs", test: (s) => s.mastered >= 25 },
  { id: "streak-7", icon: "📅", name: "Week streak", desc: "Practise 7 days in a row", test: (s) => s.bestStreak >= 7 },
  { id: "all", icon: "👑", name: "Signing star", desc: "Master every sign in the course", test: (s) => s.totalSigns > 0 && s.mastered >= s.totalSigns },
];

// The numbers the badges are tested on.
// lessons: finished lessons and phrases [{ key, perfect }] (phrase keys start with "phrase:")
export function badgeStats(vocab, attempts, records, lessons, game) {
  const isMastered = (id) => Boolean(records[id]?.mastered);
  return {
    correct: attempts.filter((a) => a.verdict === "correct" && !a.exercise?.startsWith("pick")).length,
    lessons: lessons.filter((l) => !l.key.startsWith("phrase:")).length,
    perfectLessons: lessons.filter((l) => !l.key.startsWith("phrase:") && l.perfect).length,
    perfectPhrases: lessons.filter((l) => l.key.startsWith("phrase:") && l.perfect).length,
    mastered: Object.values(records).filter((r) => r.mastered).length,
    unitsComplete: vocab.units.filter((u) => u.signs.every((s) => isMastered(s.id))).length,
    totalSigns: vocab.units.reduce((n, u) => n + u.signs.length, 0),
    goalDays: game.goalDays,
    bestStreak: game.bestStreak,
  };
}

// [{ ...badge, earned }] in display order
export function badgeList(stats) {
  return BADGES.map(({ test, ...b }) => ({ ...b, earned: test(stats) }));
}

// ids earned now that were not earned before (to announce at the end of a lesson)
export function newBadges(before, after) {
  const had = new Set(before.filter((b) => b.earned).map((b) => b.id));
  return after.filter((b) => b.earned && !had.has(b.id));
}
