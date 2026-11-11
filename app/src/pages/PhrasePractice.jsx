// Guided phrase practice ("beyond word level", supervisor meeting 1). The learner signs a known
// phrase however they like: straight through, pausing, or lowering the hand between signs. The
// phrase tracker (phraseTracker.js) finds each sign; each is judged against the expected sign at
// that position, with the same verdict + diagnostic feedback as single signs. At the end the
// phrase as a whole also gets feedback on its FLOW: how the signs were joined (phraseFlow.js).
import { useRef, useState } from "react";
import CameraView from "../components/CameraView.jsx";
import { JOINED_TEXT, PhraseVideo, VERDICT_TEXT } from "../components/ui.jsx";
import { useSignPipeline } from "../hooks/useSignPipeline.js";
import { useTemplates } from "../hooks/useTemplates.js";
import { describeIssue, fixesFor } from "../lib/diagnose.js";
import { xpFor } from "../lib/gamify.js";
import { analyseSign } from "../lib/judgeSign.js";
import { phraseFlow } from "../lib/phraseFlow.js";
import { createPhraseTracker } from "../lib/phraseTracker.js";
import { useSkipAhead } from "../components/SkipDialog.jsx";
import { isPhraseUnlocked } from "../lib/progress.js";
import { labelOf } from "../lib/vocabulary.js";

// after this long signing without the expected sign being found, suggest pausing: the app only
// watches for the expected sign while the hand keeps moving, so a wrong sign is checked at a pause
const STUCK_SECONDS = 4;

export default function PhrasePractice({ vocab, phraseIndex, progress }) {
  const phrase = vocab.phrases[phraseIndex];
  const labels = phrase.signs.map((s) => labelOf(vocab, s));
  const templatesRef = useTemplates();
  const skipper = useSkipAhead(vocab, progress);
  const trackerRef = useRef(null);
  const countRef = useRef(0);               // signs judged so far (a ref: frames arrive faster than renders)
  const [results, setResults] = useState([]);
  const [signing, setSigning] = useState(false);
  const [stillness, setStillness] = useState(0); // 0..1 while holding still (the pause ring)
  const [stuck, setStuck] = useState(false);       // signing for a while and nothing found yet

  const pipeline = useSignPipeline((frame, size, classifier, framing) => {
    if (countRef.current >= phrase.signs.length) return; // phrase finished: wait for "Try again"
    trackerRef.current ??= createPhraseTracker(size.width, size.height, classifier, phrase.signs);
    const tracker = trackerRef.current;
    const found = tracker.push(frame);
    setSigning(frame.hands.some(Boolean));
    setStillness(Math.round(tracker.stillness * 11) / 11);
    setStuck(tracker.waitingSeconds > STUCK_SECONDS);
    if (!found) return;
    const pos = countRef.current++;
    const target = phrase.signs[pos];
    const outcome = { ...analyseSign(found.frames, size, classifier, templatesRef.current, target),
      joined: found.joined, start: found.start, end: found.end };
    setResults((r) => [...r, outcome]);
    if (outcome.verdict !== "unclear") {
      progress.record({ signId: target, mode: "phrase", phrase: phrase.gloss, joined: found.joined ?? undefined,
        verdict: outcome.verdict, closeness: outcome.closeness, issues: outcome.issues, framing: framing.active });
    }
  }, { log: (type) => progress.logAction(type, `phrase/${phraseIndex}`) });

  const restart = () => {
    trackerRef.current = null;
    countRef.current = 0;
    setResults([]);
    setStuck(false);
    progress.logAction("restart", `phrase/${phraseIndex}`);
  };

  if (!isPhraseUnlocked(phrase, progress.records, progress.unlockAll, progress.skipped)) {
    return (
      <section className="empty-state">
        <span className="empty-emoji" aria-hidden="true">🔒</span>
        <h2>{phrase.gloss}</h2>
        <p>Master all the signs in this phrase first, or try it anyway.</p>
        <a className="button primary" href="#/phrases">Back to phrases</a>
        <button type="button" className="button" onClick={() => skipper.askPhrase(phraseIndex)}>⏭️ Try this phrase anyway</button>
        {skipper.dialog}
      </section>
    );
  }

  const finished = results.length === phrase.signs.length;
  const correct = results.filter((r) => r.verdict === "correct").length;
  const perfect = finished && correct === phrase.signs.length;
  const flow = finished ? phraseFlow(results, labels) : null;
  const lastSign = results.length === phrase.signs.length - 1;

  return (
    <section className="lesson">
      <header className="lesson-top">
        <a className="lesson-close" href="#/phrases" aria-label="Close phrase">✕</a>
        <div className="lesson-progress" aria-label={`${results.length} of ${phrase.signs.length} signs done`}>
          <span style={{ width: `${(results.length / phrase.signs.length) * 100}%` }} />
        </div>
      </header>
      <div className="prompt">
        <span className="prompt-kicker">Phrase · “{phrase.english}”</span>
        <h2 className="phrase-prompt">
          {labels.map((l, i) => (
            <span key={i} className={`phrase-word ${results[i] ? results[i].verdict : i === results.length ? "current" : ""}`}>{l}</span>
          ))}
        </h2>
        <p className="muted phrase-how">Sign the whole phrase in one go, moving straight from one sign to the next.</p>
      </div>

      <div className="practice-grid">
        {/* whole phrase until Start; then only the sign to make next (unless the learner picks "Whole phrase") */}
        <PhraseVideo signs={phrase.signs} labels={labels} current={pipeline.detecting && !finished ? results.length : null} />
        <div>
          <CameraView {...pipeline} onRestart={results.length > 0 ? restart : undefined} restartLabel="Restart phrase" />
          {pipeline.detecting && !finished && (
            <div className={`coach ${signing ? "signing" : "waiting"}`}>
              <span className="coach-icon still-ring" style={{ "--still": stillness }} aria-hidden="true">{signing ? "👀" : "✋"}</span>
              <span>
                Sign <strong>“{labels[results.length]}”</strong> ({results.length + 1} of {phrase.signs.length}).{" "}
                {stuck ? "Not recognised yet. Hold still or lower your hand to check this sign."
                  : !signing && results.length === 0 ? "Raise your hand to start."
                  : lastSign ? "Then hold still or lower your hand."
                  : "Then go straight into the next sign."}
              </span>
            </div>
          )}
        </div>
      </div>

      <ol className="phrase-results">
        {phrase.signs.map((s, i) => {
          const r = results[i];
          return (
            <li key={i} className={`phrase-chip ${r ? r.verdict : i === results.length ? "current" : "pending"}`}>
              {r?.joined && <span className={`chip-joined ${r.joined}`}>{JOINED_TEXT[r.joined]}</span>}
              <span className="chip-label">{labels[i]}</span>
              {r && <span className="chip-verdict">{VERDICT_TEXT[r.verdict]}{r.closeness !== undefined && ` · ${Math.round(r.closeness)}%`}</span>}
              {r?.lookedLike && <span className="chip-detail">Looked like “{labelOf(vocab, r.lookedLike)}”</span>}
              {r && r.verdict !== "correct" && fixesFor(r, 1)[0] && <span className="chip-detail">{describeIssue(fixesFor(r, 1)[0])}</span>}
            </li>
          );
        })}
      </ol>

      {finished && (
        <div className={`sheet ${perfect ? "correct" : correct > 0 ? "close" : "incorrect"}`} role="status">
          <div className="sheet-body">
            <div className="sheet-head">
              <span className="sheet-emoji" aria-hidden="true">{perfect ? "🎉" : "💪"}</span>
              <strong className="sheet-title">{perfect ? "Whole phrase correct!" : `${correct} of ${phrase.signs.length} signs correct`}</strong>
              <span className="xp-gain">+{results.reduce((n, r) => n + xpFor(r), 0)} XP</span>
            </div>
            {flow && (
              <p className="flow-summary">
                <strong>{flow.title}</strong> {flow.tip}
                {flow.seconds !== null && <span className="muted"> Whole phrase: {flow.seconds.toFixed(1)} s.</span>}
              </p>
            )}
          </div>
          <div className="sheet-actions">
            <button type="button" className="button" onClick={restart}>Try again</button>
            <a className={`button primary ${perfect ? "correct" : "close"}`} href="#/phrases">Continue</a>
          </div>
        </div>
      )}
    </section>
  );
}
