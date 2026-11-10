import { describe, expect, it } from "vitest";
import { DAILY_GOAL, gameStats, XP } from "./gamify.js";

const NOW = new Date(2026, 10, 9, 15, 0).getTime();
const DAY = 86400000;
const at = (daysAgo, verdict = "correct") => ({ timestamp: NOW - daysAgo * DAY, verdict });

describe("game stats", () => {
  it("adds XP for attempts and mastered signs", () => {
    const s = gameStats([at(0), at(0, "close"), at(1, "incorrect"), at(0, "unclear")], { a: { mastered: true }, b: {} }, NOW);
    expect(s.xp).toBe(XP.correct + XP.close + XP.incorrect + XP.mastered);
    expect(s.todayXp).toBe(XP.correct + XP.close);
  });

  it("counts the day streak, still alive if today hasn't been practised yet", () => {
    expect(gameStats([at(0), at(1), at(2), at(4)], {}, NOW).streak).toBe(3);
    const notYetToday = gameStats([at(1), at(2)], {}, NOW);
    expect(notYetToday.streak).toBe(2);
    expect(notYetToday.practisedToday).toBe(false);
    expect(gameStats([at(2)], {}, NOW).streak).toBe(0);
  });

  it("tracks the daily goal", () => {
    const n = Math.ceil(DAILY_GOAL / XP.correct);
    expect(gameStats(Array(n).fill(at(0)), {}, NOW).goalMet).toBe(true);
    expect(gameStats([at(0)], {}, NOW).goalMet).toBe(false);
  });
});
