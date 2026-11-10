import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { getAllAttempts, getAllEvents, logEvent, recordAttempt, resetProgress } from "./db.js";
import { normaliseParticipantId, sessionFileName, sessionSummary, sessionToCsv, SESSION_COLUMNS } from "./uat.js";

const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);
const session = { participantId: "P01", startedAt: T0 };

const events = [
  { participantId: "P01", type: "session-start", timestamp: T0 },
  { participantId: "P01", type: "page", page: "practice/0/0", timestamp: T0 + 1000 },
  { participantId: "P02", type: "page", page: "home", timestamp: T0 + 1500 }, // someone else
  { participantId: "P01", type: "session-end", timestamp: T0 + 90_000 },
];
const attempts = [
  { participantId: "P01", timestamp: T0 + 20_000, mode: "practice", signId: "hello", verdict: "incorrect", closeness: 40,
    issues: [{ component: "index", hint: "straighten" }], framing: ["tooFar"] },
  { participantId: "P01", timestamp: T0 + 35_500, mode: "practice", signId: "hello", verdict: "correct", closeness: 95.04, issues: [], framing: [] },
  { participantId: "P01", timestamp: T0 + 40_000, mode: "practice", signId: "bye", verdict: "unclear" },
  { timestamp: T0 + 50_000, mode: "practice", signId: "mom", verdict: "correct" }, // not in a session
];

describe("participant codes", () => {
  it("accepts codes like P01 and refuses names", () => {
    expect(normaliseParticipantId(" p01 ")).toBe("P01");
    expect(normaliseParticipantId("UAT12")).toBe("UAT12");
    expect(normaliseParticipantId("Wong Zhi Xian")).toBeNull();
    expect(normaliseParticipantId("")).toBeNull();
  });
});

describe("UAT session export", () => {
  it("merges the participant's screen visits and attempts in time order", () => {
    const lines = sessionToCsv(session, attempts, events).split("\n");
    expect(lines[0]).toBe(SESSION_COLUMNS.join(","));
    const events_ = lines.slice(1).map((l) => l.split(",")[4]);
    expect(events_).toEqual(["session-start", "page", "attempt", "attempt", "attempt", "session-end"]);
    expect(lines[2]).toContain(",1,page,practice/0/0,");
    expect(lines[3]).toBe(`P01,${T0 + 20_000},2026-11-16T02:00:20.000Z,20,attempt,,practice,hello,,,incorrect,40,index:straighten,tooFar`);
    expect(lines[4]).toContain(",35.5,attempt,");
    expect(lines.join("\n")).not.toContain("P02");
    expect(lines.join("\n")).not.toContain("mom");
  });

  it("summarises the session", () => {
    expect(sessionSummary(session, attempts, T0 + 90_000)).toEqual({
      minutes: 1.5, attempts: 3, signsTried: 2, accuracy: 50, badFramingShare: 33,
    });
  });

  it("names the file after the participant and date", () => {
    expect(sessionFileName(session)).toMatch(/^uat-P01-202611\d\d\.csv$/);
  });
});

describe("UAT storage", () => {
  it("keeps participant codes on attempts, logs events, and resets both", async () => {
    await resetProgress();
    await logEvent({ participantId: "P03", type: "session-start" });
    await recordAttempt({ signId: "hello", mode: "practice", verdict: "correct", closeness: 90, participantId: "P03", framing: ["dark"] });
    const [a] = await getAllAttempts();
    expect(a.participantId).toBe("P03");
    expect(a.framing).toEqual(["dark"]);
    expect((await getAllEvents()).map((e) => e.type)).toEqual(["session-start"]);
    await resetProgress();
    expect(await getAllEvents()).toEqual([]);
    expect(await getAllAttempts()).toEqual([]);
  });
});
