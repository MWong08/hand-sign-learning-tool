// Guided phrase practice ("beyond word level", supervisor meeting 1). The learner signs a known
// phrase; it is cut into signs either by pauses (segmenter.js) or, in fluent mode, by the
// sliding-window decoder (fluent.js), and each sign is judged against the expected sign at that
// position, with the same verdict + diagnostic feedback as single signs.
import { useRef, useState } from "react";
import CameraView from "../components/CameraView.jsx";
import ModeSwitch, { useSigningMode } from "../components/ModeSwitch.jsx";
import { PhraseVideo, VERDICT_TEXT } from "../components/ui.jsx";
import { useSignPipeline } from "../hooks/useSignPipeline.js";
import { useTemplates } from "../hooks/useTemplates.js";
import { describeIssue, fixesFor } from "../lib/diagnose.js";
import { createFluentDecoder } from "../lib/fluent.js";
import { xpFor } from "../lib/gamify.js";
import { analyseSign } from "../lib/judgeSign.js";
import { useSkipAhead } from "../components/SkipDialog.jsx";
import { isPhraseUnlocked } from "../lib/progress.js";
import { createSegmenter } from "../lib/segmenter.js";
import { labelOf } from "../lib/vocabulary.js";

export default function PhrasePractice({ vocab, phraseIndex, progress }) {
  const phrase = vocab.phrases[phraseIndex];
  const labels = phrase.signs.map((s) => labelOf(vocab, s));
  const templatesRef = useTemplates();
  const skipper = useSkipAhead(vocab, progress);
  const [mode, setModeState] = useSigningMode();
  const modeRef = useRef(mode);
  const splitterRef = useRef(null);         // segmenter (pause mode) or fluent decoder
  const countRef = useRef(0);               // signs judged so far (a ref: frames arrive faster than renders)
  const [results, setResults] = useState([]);
  const [signing, setSigning] = useState(false);

  const pipeline = useSignPipeline((frame, size, classifier, framing) => {
    if (countRef.current >= phrase.signs.length) return; // phrase finished: wait for "Try again"
    if (!splitterRef.current) {
      splitterRef.current = modeRef.current === "fluent"
        ? createFluentDecoder(size.width, size.height, classifier.predictBatch, classifier.labels)
        : createSegmenter(size.width, size.height);
    }
    const splitter = splitterRef.current;
    const seg = splitter.push(frame);
    setSigning(modeRef.current === "pause" ? splitter.state === "active" : frame.hands.some(Boolean));
    if (!seg) return;
    const pos = countRef.current++;
    const target = phrase.signs[pos];
    const outcome = analyseSign(seg.frames, size, classifier, templatesRef.current, target);
    setResults((r) => [...r, outcome]);
    if (outcome.verdict !== "unclear") {
      progress.record({ signId: target, mode: modeRef.current === "fluent" ? "phrase-fluent" : "phrase", phrase: phrase.gloss,
        verdict: outcome.verdict, closeness: outcome.closeness, issues: outcome.issues, framing: framing.active });
    }
  });

  const restart = () => {
    splitterRef.current = null;
    countRef.current = 0;
    setResults([]);
  };
  const setMode = (m) => {
    modeRef.current = m;
    setModeState(m);
    restart();
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
      </div>
      <ModeSwitch mode={mode} onChange={setMode} />

      <div className="practice-grid">
        <PhraseVideo signs={phrase.signs} labels={labels} />
        <div>
          <CameraView {...pipeline} />
          {pipeline.status === "ready" && !finished && (
            <div className={`coach ${signing ? "signing" : "waiting"}`}>
              <span className="coach-icon" aria-hidden="true">{signing ? "👀" : "✋"}</span>
              <span>
                Sign <strong>“{labels[results.length]}”</strong> ({results.length + 1} of {phrase.signs.length}).{" "}
                {mode === "fluent" ? "Keep going straight into the next sign."
                  : signing ? "Pause or lower your hand when you finish this sign." : "Raise your hand to start."}
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
