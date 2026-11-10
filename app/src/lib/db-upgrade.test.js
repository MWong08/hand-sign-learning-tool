import "fake-indexeddb/auto";
import { expect, it } from "vitest";

// A browser that used the app before UAT mode has a version-1 database. Opening it with the
// current db.js must add the events store and keep the existing progress.
it("upgrades a version-1 database without losing progress", async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open("sign-practice", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const attempts = db.createObjectStore("attempts", { keyPath: "id", autoIncrement: true });
      attempts.createIndex("signId", "signId");
      attempts.createIndex("timestamp", "timestamp");
      db.createObjectStore("signs", { keyPath: "signId" });
      db.createObjectStore("settings", { keyPath: "key" });
      attempts.add({ signId: "hello", mode: "practice", verdict: "correct", timestamp: 1 });
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  });

  const db = await import("./db.js");
  expect((await db.getAllAttempts()).map((a) => a.signId)).toEqual(["hello"]);
  await db.logEvent({ participantId: "P01", type: "session-start" });
  expect((await db.getAllEvents()).length).toBe(1);
});
