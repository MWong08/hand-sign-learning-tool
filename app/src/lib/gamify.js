// Motivation layer (education-app style): XP, a daily goal and a day streak, all computed from
// the saved attempts and the log of finished lessons, so the numbers can't drift out of sync.
// Effort is rewarded (a wrong attempt still earns a little), mastery more.
// Lessons add: a bonus for finishing one, and more for a perfect one (everything right first time).

export const XP = { correct: 10, close: 5, incorrect: 2, unclear: 0, mastered: 20, pick: 5, lesson: 10, perfect: 10 };
export const DAILY_GOAL = 50; // XP: about five correct signs

export const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const isPickAttempt = (a) => a.exercise === "pick-word" || a.exercise === "pick-video";

// multiple-choice answers (lessons) earn a little for a right answer only
export const xpFor = (attempt) => (isPickAttempt(attempt) ? (attempt.verdict === "correct" ? XP.pick : 0) : XP[attempt.verdict] ?? 0);

// bonus for a finished lesson { perfect }
export const lessonBonus = (lesson) => XP.lesson + (lesson.perfect ? XP.perfect : 0);

// consecutive days with practice, ending at day `end` (a timestamp)
function runEnding(days, end) {
  const DAY = 86400000;
  let n = 0;
  let t = end;
  while (days.has(dayKey(t))) {
    n++;
    t -= DAY;
  }
  return n;
}

// attempts: every saved attempt; records: { signId: sign record }; lessons: finished lessons
// [{ key, at, perfect }]; now: for tests
export function gameStats(attempts, records, now = Date.now(), lessons = []) {
  const mastered = Object.values(records).filter((r) => r.mastered).length;
  const today = dayKey(now);
  const earned = [
    ...attempts.map((a) => ({ day: dayKey(a.timestamp), xp: xpFor(a) })),
    ...lessons.map((l) => ({ day: dayKey(l.at), xp: lessonBonus(l) })),
  ];
  const total = earned.reduce((s, e) => s + e.xp, 0) + mastered * XP.mastered;
  const todayXp = earned.filter((e) => e.day === today).reduce((s, e) => s + e.xp, 0);

  // streak: consecutive days with practice, ending today, or yesterday if not practised yet today
  const days = new Set(attempts.map((a) => dayKey(a.timestamp)));
  const streak = runEnding(days, days.has(today) ? now : now - 86400000);
  // longest streak ever and days the goal was met (for badges)
  const bestStreak = Math.max(0, ...attempts.map((a) => runEnding(days, a.timestamp)));
  const perDay = {};
  for (const e of earned) perDay[e.day] = (perDay[e.day] ?? 0) + e.xp;
  const goalDays = Object.values(perDay).filter((x) => x >= DAILY_GOAL).length;
  return {
    xp: total,
    todayXp,
    goal: DAILY_GOAL,
    goalMet: todayXp >= DAILY_GOAL,
    streak,
    bestStreak,
    goalDays,
    practisedToday: days.has(today),
  };
}
