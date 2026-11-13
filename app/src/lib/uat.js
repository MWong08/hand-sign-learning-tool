// User acceptance testing (UAT) mode: one session per participant. While a session is active,
// every attempt is tagged with the participant code and every screen visited is logged, so
// after the session one CSV holds everything needed for Chapter 5: what they did, in what
// order, how long it took, how the recogniser judged them, and whether their camera set-up
// was OK at the time.
import { csvCell } from "./history.js";

// Participant codes such as P01. Names are refused on purpose: the data stays anonymous (ethics).
export const PARTICIPANT_PATTERN = /^[A-Z]{1,3}\d{1,3}$/;

export function normaliseParticipantId(text) {
  const id = text.trim().toUpperCase();
  return PARTICIPANT_PATTERN.test(id) ? id : null;
}

export const SESSION_COLUMNS = ["participant", "timestamp", "time", "seconds_from_start", "event", "page",
  "mode", "exercise", "sign", "phrase", "joined", "verdict", "closeness", "issues", "framing"];

// One CSV with the session's screen visits and attempts in time order.
// session: { participantId, startedAt }
export function sessionToCsv(session, attempts, events) {
  const mine = (r) => r.participantId === session.participantId && r.timestamp >= session.startedAt;
  const rows = [
    ...events.filter(mine).map((e) => ({ ...e, event: e.type })),
    ...attempts.filter(mine).map((a) => ({ ...a, event: "attempt" })),
  ].sort((a, b) => a.timestamp - b.timestamp || (a.event === "attempt") - (b.event === "attempt"));

  const lines = rows.map((r) => [
    session.participantId,
    r.timestamp,
    new Date(r.timestamp).toISOString(),
    Math.round((r.timestamp - session.startedAt) / 100) / 10,
    r.event,
    r.page ?? "",
    r.mode ?? "",
    r.exercise ?? "",
    r.signId ?? "",
    r.phrase ?? "",
    r.joined ?? "",
    r.verdict ?? "",
    r.closeness === undefined ? "" : Math.round(r.closeness * 10) / 10,
    (r.issues ?? []).map((i) => `${i.component}:${i.hint}`).join("; "),
    (r.framing ?? []).join("; "),
  ]);
  return [SESSION_COLUMNS, ...lines].map((r) => r.map(csvCell).join(",")).join("\n");
}

// Headline numbers for the end-of-session screen (and the UAT results table).
export function sessionSummary(session, attempts, endedAt = Date.now()) {
  const mine = attempts.filter((a) => a.participantId === session.participantId && a.timestamp >= session.startedAt);
  const judged = mine.filter((a) => a.verdict !== "unclear");
  const correct = judged.filter((a) => a.verdict === "correct").length;
  const badFraming = mine.filter((a) => a.framing?.length).length;
  return {
    minutes: Math.round((endedAt - session.startedAt) / 6000) / 10,
    attempts: mine.length,
    signsTried: new Set(mine.map((a) => a.signId)).size,
    accuracy: judged.length ? Math.round((correct / judged.length) * 100) : 0,
    badFramingShare: mine.length ? Math.round((badFraming / mine.length) * 100) : 0,
  };
}

export function sessionFileName(session) {
  const d = new Date(session.startedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `uat-${session.participantId}-${stamp}.csv`;
}
