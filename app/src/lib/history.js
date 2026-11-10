// Practice-history summaries and CSV export (for the learner's progress page, and for analysing
// UAT sessions: export a participant's attempts after their session).

const CSV_COLUMNS = ["timestamp", "date", "mode", "sign", "phrase", "verdict", "closeness", "issues", "framing"];

// RFC 4180 quoting: wrap in quotes if the value has a comma, quote or newline; double inner quotes
export function csvCell(value) {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function attemptsToCsv(attempts) {
  const rows = attempts.map((a) => [
    a.timestamp,
    new Date(a.timestamp).toISOString(),
    a.mode,
    a.signId,
    a.phrase ?? "",
    a.verdict,
    a.closeness === undefined ? "" : Math.round(a.closeness * 10) / 10,
    (a.issues ?? []).map((i) => `${i.component}:${i.hint}`).join("; "),
    (a.framing ?? []).join("; "),
  ]);
  return [CSV_COLUMNS, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

// Overall numbers for the progress page
export function summarise(attempts, records) {
  const judged = attempts.filter((a) => a.verdict !== "unclear");
  const correct = judged.filter((a) => a.verdict === "correct").length;
  const withCloseness = judged.filter((a) => a.closeness !== undefined);
  const days = new Set(attempts.map((a) => new Date(a.timestamp).toDateString()));
  return {
    attempts: attempts.length,
    accuracy: judged.length ? Math.round((correct / judged.length) * 100) : 0,
    averageCloseness: withCloseness.length
      ? Math.round(withCloseness.reduce((s, a) => s + a.closeness, 0) / withCloseness.length) : 0,
    mastered: Object.values(records).filter((r) => r.mastered).length,
    daysPractised: days.size,
  };
}
