// Learner progress for the whole app: loads every sign's record from IndexedDB once, and
// saves each new attempt (updating mastery). Shared by all screens through App.jsx.
// Also holds the UAT session (lib/uat.js): while one is active, attempts are tagged with the
// participant code and logPage() records each screen visited.
// Finished lessons (and phrases) are kept in a small log (settings "lessons"), for lesson stars,
// bonus XP and badges.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAllAttempts, getAllSignProgress, getSetting, logEvent, recordAttempt, resetProgress, setSetting } from "../lib/db.js";
import { gameStats } from "../lib/gamify.js";
import { isSigned } from "../lib/review.js";

export function useProgress() {
  const [records, setRecords] = useState({}); // { signId: record }
  const [attempts, setAttempts] = useState([]); // every saved attempt (for XP and streak)
  const [unlockAll, setUnlockAllState] = useState(false);
  const [skipped, setSkipped] = useState([]); // units / phrases skipped ahead to (progress.js skipKey)
  const [lessons, setLessons] = useState([]); // finished lessons and phrases [{ key, at, stars, perfect, accuracy }]
  const lessonsRef = useRef([]);
  lessonsRef.current = lessons;
  const [uatSession, setUatSessionState] = useState(null); // { participantId, startedAt } | null
  const [lastUatSession, setLastUatSession] = useState(null); // the most recent ended session
  const [loaded, setLoaded] = useState(false);
  const sessionRef = useRef(null); // the same session, readable inside callbacks without re-creating them
  sessionRef.current = uatSession;
  const skippedRef = useRef([]);
  skippedRef.current = skipped;

  useEffect(() => {
    Promise.all([getAllSignProgress(), getSetting("unlockAll", false), getSetting("uatSession", null), getSetting("uatLast", null), getAllAttempts(), getSetting("skipped", []), getSetting("lessons", [])])
      .then(([r, u, s, last, a, sk, l]) => { setRecords(r); setUnlockAllState(u); setUatSessionState(s); setLastUatSession(last); setAttempts(a); setSkipped(sk); setLessons(l); })
      .catch(() => {}) // storage unavailable (e.g. private mode): the app still works, unsaved
      .finally(() => setLoaded(true));
  }, []);

  // save an attempt; returns { record, newlyMastered }
  const record = useCallback(async (attempt) => {
    try {
      const participantId = sessionRef.current?.participantId;
      const result = await recordAttempt(participantId ? { ...attempt, participantId } : attempt);
      // (a multiple-choice answer leaves the sign's record as it was)
      if (isSigned(attempt)) setRecords((prev) => ({ ...prev, [attempt.signId]: result.record }));
      setAttempts((prev) => [...prev, { ...attempt, timestamp: Date.now() }]);
      return result;
    } catch {
      return { record: null, newlyMastered: false };
    }
  }, []);

  const setUnlockAll = useCallback(async (value) => {
    setUnlockAllState(value);
    await setSetting("unlockAll", value).catch(() => {});
  }, []);

  // skip ahead to a locked unit or phrase (the page asks for confirmation first); logged in UAT mode
  const skip = useCallback(async (key) => {
    if (skippedRef.current.includes(key)) return;
    const next = [...skippedRef.current, key];
    skippedRef.current = next;
    setSkipped(next);
    await setSetting("skipped", next).catch(() => {});
    const session = sessionRef.current;
    if (session) await logEvent({ participantId: session.participantId, type: "skip", page: key }).catch(() => {});
  }, []);

  // a lesson or phrase was finished: { key, stars?, perfect, accuracy? }; logged in UAT mode
  const completeLesson = useCallback(async (entry) => {
    const next = [...lessonsRef.current, { ...entry, at: Date.now() }];
    lessonsRef.current = next;
    setLessons(next);
    await setSetting("lessons", next).catch(() => {});
    const session = sessionRef.current;
    if (session) await logEvent({ participantId: session.participantId, type: "lesson-done", page: entry.key }).catch(() => {});
  }, []);

  const clearProgress = async () => {
    await resetProgress().catch(() => {});
    await setSetting("skipped", []).catch(() => {});
    await setSetting("lessons", []).catch(() => {});
    setRecords({});
    setAttempts([]);
    setSkipped([]);
    setLessons([]);
  };

  const reset = useCallback(clearProgress, []);

  // fresh: clear the previous participant's progress first, so everyone starts at Unit 1
  const startUatSession = useCallback(async (participantId, { fresh = true } = {}) => {
    if (fresh) await clearProgress();
    const session = { participantId, startedAt: Date.now() };
    await setSetting("uatSession", session).catch(() => {});
    await logEvent({ participantId, type: "session-start" }).catch(() => {});
    setUatSessionState(session);
    return session;
  }, []);

  const endUatSession = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return null;
    await logEvent({ participantId: session.participantId, type: "session-end" }).catch(() => {});
    const ended = { ...session, endedAt: Date.now() };
    await setSetting("uatSession", null).catch(() => {});
    await setSetting("uatLast", ended).catch(() => {});
    setUatSessionState(null);
    setLastUatSession(ended);
    return ended;
  }, []);

  const logPage = useCallback((page) => {
    const session = sessionRef.current;
    if (session) logEvent({ participantId: session.participantId, type: "page", page }).catch(() => {});
  }, []);

  // camera controls (start / pause / restart) on a screen; logged in UAT mode, to see how often
  // testers needed to stop or start over
  const logAction = useCallback((type, page) => {
    const session = sessionRef.current;
    if (session) logEvent({ participantId: session.participantId, type, page }).catch(() => {});
  }, []);

  const game = useMemo(() => gameStats(attempts, records, Date.now(), lessons), [attempts, records, lessons]);

  return {
    records, attempts, game, lessons, completeLesson, unlockAll, skipped, skip, loaded, record, setUnlockAll, reset,
    uatSession, lastUatSession, startUatSession, endUatSession, logPage, logAction,
  };
}
