// Learner progress for the whole app: loads every sign's record from IndexedDB once, and
// saves each new attempt (updating mastery). Shared by all screens through App.jsx.
// Also holds the UAT session (lib/uat.js): while one is active, attempts are tagged with the
// participant code and logPage() records each screen visited.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAllAttempts, getAllSignProgress, getSetting, logEvent, recordAttempt, resetProgress, setSetting } from "../lib/db.js";
import { gameStats } from "../lib/gamify.js";

export function useProgress() {
  const [records, setRecords] = useState({}); // { signId: record }
  const [attempts, setAttempts] = useState([]); // every saved attempt (for XP and streak)
  const [unlockAll, setUnlockAllState] = useState(false);
  const [skipped, setSkipped] = useState([]); // units / phrases skipped ahead to (progress.js skipKey)
  const [uatSession, setUatSessionState] = useState(null); // { participantId, startedAt } | null
  const [lastUatSession, setLastUatSession] = useState(null); // the most recent ended session
  const [loaded, setLoaded] = useState(false);
  const sessionRef = useRef(null); // the same session, readable inside callbacks without re-creating them
  sessionRef.current = uatSession;
  const skippedRef = useRef([]);
  skippedRef.current = skipped;

  useEffect(() => {
    Promise.all([getAllSignProgress(), getSetting("unlockAll", false), getSetting("uatSession", null), getSetting("uatLast", null), getAllAttempts(), getSetting("skipped", [])])
      .then(([r, u, s, last, a, sk]) => { setRecords(r); setUnlockAllState(u); setUatSessionState(s); setLastUatSession(last); setAttempts(a); setSkipped(sk); })
      .catch(() => {}) // storage unavailable (e.g. private mode): the app still works, unsaved
      .finally(() => setLoaded(true));
  }, []);

  // save an attempt; returns { record, newlyMastered }
  const record = useCallback(async (attempt) => {
    try {
      const participantId = sessionRef.current?.participantId;
      const result = await recordAttempt(participantId ? { ...attempt, participantId } : attempt);
      setRecords((prev) => ({ ...prev, [attempt.signId]: result.record }));
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

  const clearProgress = async () => {
    await resetProgress().catch(() => {});
    await setSetting("skipped", []).catch(() => {});
    setRecords({});
    setAttempts([]);
    setSkipped([]);
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

  const game = useMemo(() => gameStats(attempts, records), [attempts, records]);

  return {
    records, attempts, game, unlockAll, skipped, skip, loaded, record, setUnlockAll, reset,
    uatSession, lastUatSession, startUatSession, endUatSession, logPage,
  };
}
