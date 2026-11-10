// Motivation layer (education-app style): XP, a daily goal and a day streak, all computed from
// the saved attempts, so nothing extra is stored and the numbers can't drift out of sync.
// Effort is rewarded (a wrong attempt still earns a little), mastery more.

export const XP = { correct: 10, close: 5, incorrect: 2, unclear: 0, mastered: 20 };
export const DAILY_GOAL = 50; // XP: about five correct signs

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export const xpFor = (attempt) => XP[attempt.verdict] ?? 0;

// attempts: every saved attempt; records: { signId: sign record }; now: for tests
export function gameStats(attempts, records, now = Date.now()) {
  const mastered = Object.values(records).filter((r) => r.mastered).length;
  const total = attempts.reduce((s, a) => s + xpFor(a), 0) + mastered * XP.mastered;
  const today = dayKey(now);
  const todayXp = attempts.filter((a) => dayKey(a.timestamp) === today).reduce((s, a) => s + xpFor(a), 0);

  // streak: consecutive days with practice, ending today, or yesterday if not practised yet today
  const days = new Set(attempts.map((a) => dayKey(a.timestamp)));
  const DAY = 86400000;
  let streak = 0;
  let t = days.has(today) ? now : now - DAY;
  while (days.has(dayKey(t))) {
    streak++;
    t -= DAY;
  }
  return {
    xp: total,
    todayXp,
    goal: DAILY_GOAL,
    goalMet: todayXp >= DAILY_GOAL,
    streak,
    practisedToday: days.has(today),
  };
}
