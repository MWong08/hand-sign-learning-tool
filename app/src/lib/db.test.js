import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";

// a fresh, empty database for each test
beforeEach(() => {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
});

it("saves multiple-choice answers in the history without counting them towards mastery", async () => {
  const { getAllAttempts, getAllSignProgress, recordAttempt } = await import("./db.js");
  await recordAttempt({ signId: "hello", mode: "lesson", exercise: "pick-word", verdict: "correct" });
  await recordAttempt({ signId: "hello", mode: "lesson", exercise: "pick-video", verdict: "correct" });
  expect(await getAllAttempts()).toHaveLength(2);
  expect(await getAllSignProgress()).toEqual({}); // no sign record yet

  // signing does count: two correct in a row masters the sign
  await recordAttempt({ signId: "hello", mode: "lesson", exercise: "watch", verdict: "correct", closeness: 80 });
  const { newlyMastered, record } = await recordAttempt({ signId: "hello", mode: "lesson", exercise: "recall", verdict: "correct", closeness: 70 });
  expect(newlyMastered).toBe(true);
  expect(record.attempts).toBe(2);
});
