// Learner progress, stored in the browser with IndexedDB (IR FR6 "lightweight progress tracking,
// browser-local"; IR 2.4.4: no server-side database, data never leaves the device).
//
// Object stores (these are the classes in the report's database class diagram):
//   attempts  { id (auto), signId, mode, verdict, closeness, issues, phrase, timestamp }
//             one row per practice attempt (history)
//   signs     { signId, attempts, correct, streak, bestCloseness, mastered, masteredAt, lastPracticed }
//             one row per sign, updated with every attempt (see progress.js applyAttempt)
//   settings  { key, value }   e.g. unlockAll, uatSession
//   events    { id (auto), participantId, type, page, timestamp }
//             user-testing log (UAT mode only): session start/end and every screen visited
// Attempts made during a UAT session also carry participantId; every attempt carries framing
// (the camera set-up problems active when it ended, lib/framing.js).
import { applyAttempt, emptySignRecord } from "./progress.js";

const DB_NAME = "sign-practice";
const DB_VERSION = 2; // 2: added the events store (existing progress is kept)

let dbPromise = null;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          const attempts = db.createObjectStore("attempts", { keyPath: "id", autoIncrement: true });
          attempts.createIndex("signId", "signId");
          attempts.createIndex("timestamp", "timestamp");
          db.createObjectStore("signs", { keyPath: "signId" });
          db.createObjectStore("settings", { keyPath: "key" });
        }
        if (e.oldVersion < 2) db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => {
        const db = req.result;
        // A newer version of the app was opened in another tab and needs to upgrade the database:
        // let go of it (otherwise that tab waits forever) and reload to pick up the new version.
        db.onversionchange = () => {
          db.close();
          window.location.reload();
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      // An older tab is still holding the database open (one from before onversionchange existed).
      req.onblocked = () => console.warn("Close other tabs of this app so it can update its saved data.");
    });
  }
  return dbPromise;
}

// wrap an IndexedDB request in a promise
const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const committed = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

// Save one attempt and update that sign's progress in a single transaction.
// attempt: { signId, mode, verdict, closeness?, issues?, phrase?, joined?, framing?, participantId? }
// (joined: for phrase signs after the first, "flowing" | "paused" | "lowered", phraseTracker.js)
// returns { record: the updated sign record, newlyMastered: true if this attempt earned mastery }
export async function recordAttempt(attempt) {
  const db = await openDb();
  const tx = db.transaction(["attempts", "signs"], "readwrite");
  const row = { ...attempt, issues: (attempt.issues ?? []).map(({ component, hint }) => ({ component, hint })), timestamp: Date.now() };
  tx.objectStore("attempts").add(row);
  const signs = tx.objectStore("signs");
  const current = (await done(signs.get(attempt.signId))) ?? emptySignRecord(attempt.signId);
  const updated = applyAttempt(current, row);
  signs.put(updated);
  await committed(tx);
  return { record: updated, newlyMastered: updated.mastered && !current.mastered };
}

// { signId: record } for every sign practised so far
export async function getAllSignProgress() {
  const db = await openDb();
  const rows = await done(db.transaction("signs").objectStore("signs").getAll());
  return Object.fromEntries(rows.map((r) => [r.signId, r]));
}

// every attempt, oldest first (for the progress page and CSV export)
export async function getAllAttempts() {
  const db = await openDb();
  return done(db.transaction("attempts").objectStore("attempts").index("timestamp").getAll());
}

export async function getAttempts(signId) {
  const db = await openDb();
  return done(db.transaction("attempts").objectStore("attempts").index("signId").getAll(signId));
}

export async function getSetting(key, fallback = null) {
  const db = await openDb();
  const row = await done(db.transaction("settings").objectStore("settings").get(key));
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  const db = await openDb();
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").put({ key, value });
  await committed(tx);
}

// Delete all progress and history (a "reset progress" button, and between UAT participants).
export async function resetProgress() {
  const db = await openDb();
  const tx = db.transaction(["attempts", "signs", "events"], "readwrite");
  tx.objectStore("attempts").clear();
  tx.objectStore("signs").clear();
  tx.objectStore("events").clear();
  await committed(tx);
}

// UAT log. event: { participantId, type: "session-start" | "session-end" | "page" | "skip", page? }
// (for "skip", page is the skipped item: "unit:<id>" or "phrase:<gloss>"; for the camera
//  controls "start", "pause" and "restart", page is the screen, e.g. "phrase/1")
export async function logEvent(event) {
  const db = await openDb();
  const tx = db.transaction("events", "readwrite");
  tx.objectStore("events").add({ ...event, timestamp: Date.now() });
  await committed(tx);
}

export async function getAllEvents() {
  const db = await openDb();
  return done(db.transaction("events").objectStore("events").getAll());
}
