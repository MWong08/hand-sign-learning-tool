// Phrase-level feedback (2026-11-11): beyond judging each sign, how FLUENTLY the phrase was
// signed. Fluent signers move straight from one sign to the next; beginners tend to stop, or
// drop the hand, between signs. The phrase tracker (phraseTracker.js) records how each sign
// was joined to the one before ("flowing" | "paused" | "lowered"); this turns that into a short
// summary and one tip, naming the first place the learner stopped.

// results: the phrase's judged signs in order, each { joined, start, end } (frame counts, 15 fps)
// labels: the signs' display names. Returns { title, tip, smooth, transitions, seconds } or null.
export function phraseFlow(results, labels) {
  const transitions = results.slice(1).map((r) => r.joined);
  if (transitions.length === 0) return null;
  const smooth = transitions.filter((j) => j === "flowing").length;
  const first = results[0].start, last = results.at(-1).end;
  const seconds = Number.isFinite(first) && Number.isFinite(last) && last > first ? (last - first) / 15 : null;
  const where = (k) => `between “${labels[k]}” and “${labels[k + 1]}”`;

  if (smooth === transitions.length) {
    return { title: "🌊 Smooth flow!", tip: "You went straight from sign to sign, like a fluent signer.", smooth, transitions: transitions.length, seconds };
  }
  const lowered = transitions.indexOf("lowered");
  const paused = transitions.indexOf("paused");
  const tip = lowered >= 0
    ? `You dropped your hand ${where(lowered)}. Try keeping it up and moving straight into the next sign.`
    : `You paused ${where(paused)}. Next time, try moving straight into the next sign.`;
  return { title: `Flow: ${smooth} of ${transitions.length} joins smooth.`, tip, smooth, transitions: transitions.length, seconds };
}
