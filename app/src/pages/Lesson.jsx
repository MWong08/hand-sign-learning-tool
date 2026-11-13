// A lesson (supervisor meeting 2: "repeat each sign in different scenarios, like Duolingo"):
// a sequence of exercises from lib/lesson.js, in which every new sign comes back several times:
// copy it with the video, recognise it (multiple choice), sign it from memory, use it in a phrase.
//
//   - one camera session for the whole lesson (no reload between exercises); multiple-choice
//     exercises hide the camera and ignore its frames
//   - an exercise not answered correctly comes back once more at the end of the lesson
//   - a combo counter for answers right at the first try, small toasts for combos and mastery
//   - at the end, LessonSummary: stars, XP, every sign's results and a side-by-side replay
//
// Attempts are saved like practice attempts (mode "lesson", exercise = the exercise type), so
// signing in a lesson counts towards mastery; multiple-choice answers do not (db.js).
// The camera loop reads the current exercise through refs, because frames arrive faster than
// React re-renders.
import { useEffect, useMemo, useRef, useState } from "react";
import CameraView from "../components/CameraView.jsx";
import LessonSummary from "../components/LessonSummary.jsx";
import PhraseChips from "../components/PhraseChips.jsx";
import ReferencePanel from "../components/ReferencePanel.jsx";
import ResultSheet from "../components/ResultSheet.jsx";
import { PhraseVideo, SignVideo } from "../components/ui.jsx";
import { useSignPipeline } from "../hooks/useSignPipeline.js";
import { useTemplates } from "../hooks/useTemplates.js";
import { createAttemptRecorder } from "../lib/attempt.js";
import { badgeList, badgeStats } from "../lib/badges.js";
import { analyseSign } from "../lib/judgeSign.js";
import { CAMERA_TYPES, isPick, planLesson } from "../lib/lesson.js";
import { phraseFlow } from "../lib/phraseFlow.js";
import { createPhraseTracker } from "../lib/phraseTracker.js";
import { isUnitUnlocked } from "../lib/progress.js";
import { labelOf } from "../lib/vocabulary.js";

const STUCK_SECONDS = 4; // phrase: suggest pausing after this long without the expected sign
const COMBO_TOASTS = new Set([3, 5, 10, 15, 20]);

// target: { kind: "lesson", unitIndex, lessonIndex } | { kind: "unit-review", unitIndex } | { kind: "review" }
export default function Lesson({ vocab, progress, target }) {
  const unlocked = useMemo(() => vocab.units
    .filter((_, k) => isUnitUnlocked(vocab.units, k, progress.records, progress.unlockAll, progress.skipped))
    .flatMap((u) => u.signs.map((s) => s.id)), [vocab, progress.records, progress.unlockAll, progress.skipped]);
  // built once: the plan is random (option order, review signs) and must not change mid-lesson
  const [plan] = useState(() => planLesson(vocab, target, { attempts: progress.attempts, unlocked }));

  if (target.unitIndex !== undefined && !isUnitUnlocked(vocab.units, target.unitIndex, progress.records, progress.unlockAll, progress.skipped)) {
    return (
      <section className="empty-state">
        <span className="empty-emoji" aria-hidden="true">🔒</span>
        <h2>This unit is locked</h2>
        <p>Master the unit before it first, or skip ahead from the unit page.</p>
        <a className="button primary" href={`#/unit/${target.unitIndex}`}>Go to the unit</a>
      </section>
    );
  }
  if (!plan) {
    return (
      <section className="empty-state">
        <span className="empty-emoji" aria-hidden="true">{target.kind === "review" ? "🌟" : "🤔"}</span>
        <h2>{target.kind === "review" ? "Nothing to review" : "Lesson not found"}</h2>
        <p>{target.kind === "review" ? "No weak signs right now. Keep practising and any sign you find hard will show up here." : ""}</p>
        <a className="button primary" href="#/">Back to the path</a>
      </section>
    );
  }
  return <LessonRunner vocab={vocab} progress={progress} plan={plan} target={target} />;
}

function LessonRunner({ vocab, progress, plan, target }) {
  const templatesRef = useTemplates();
  const [queue, setQueue] = useState(plan.exercises);
  const queueRef = useRef(plan.exercises);
  const [pos, setPos] = useState(0);
  const [entries, setEntries] = useState([]); // per queue position: { tries: [...], skipped }
  const entriesRef = useRef([]);
  const [phase, setPhase] = useState("waiting"); // waiting | signing | result
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const comboRef = useRef(0);
  const [toast, setToast] = useState(null);
  const recorderRef = useRef(createAttemptRecorder());
  // phrase exercise
  const trackerRef = useRef(null);
  const phraseRef = useRef([]); // results of the phrase being signed
  const [phraseResults, setPhraseResults] = useState([]);
  const [handUp, setHandUp] = useState(false);
  const [stillness, setStillness] = useState(0);
  const [stuck, setStuck] = useState(false);
  const startedAt = useRef(Date.now());
  // badges held when the lesson started, to announce new ones at the end
  const [badgesBefore] = useState(() => badgeList(badgeStats(vocab, progress.attempts, progress.records, progress.lessons, progress.game)));
  const page = target.kind === "review" ? "review" : `lesson/${target.unitIndex}/${target.kind === "unit-review" ? "review" : target.lessonIndex}`;

  const ex = queue[pos];
  const stateRef = useRef({});
  stateRef.current = { ex, pos };

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    progress.logAction("lesson-start", page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // add a try to the exercise at queue position p; the first try decides the combo
  const addTry = (p, attempt) => {
    const prev = entriesRef.current[p] ?? { tries: [] };
    const first = prev.tries.length === 0;
    const next = [...entriesRef.current];
    next[p] = { ...prev, tries: [...prev.tries, attempt] };
    entriesRef.current = next;
    setEntries(next);
    if (first && attempt.verdict !== "unclear") {
      const c = attempt.verdict === "correct" ? comboRef.current + 1 : 0;
      comboRef.current = c;
      setCombo(c);
      setBestCombo((b) => Math.max(b, c));
      if (COMBO_TOASTS.has(c)) setToast(`🔥 ${c} in a row!`);
    }
  };

  const save = (attempt) => progress.record(attempt).then(({ newlyMastered }) => {
    if (newlyMastered) setToast(`⭐ You mastered “${labelOf(vocab, attempt.signId)}”!`);
  });

  const pipeline = useSignPipeline((frame, size, classifier, framing) => {
    const { ex: cur, pos: p } = stateRef.current;
    if (!cur || !CAMERA_TYPES.has(cur.type)) return; // multiple choice: camera not used
    const entry = entriesRef.current[p];

    if (cur.type === "phrase") {
      const signs = cur.phrase.signs;
      if (phraseRef.current.length >= signs.length) return; // finished: wait for Continue / Try again
      trackerRef.current ??= createPhraseTracker(size.width, size.height, classifier, signs);
      const tracker = trackerRef.current;
      const found = tracker.push(frame);
      setHandUp(frame.hands.some(Boolean));
      setStillness(Math.round(tracker.stillness * 11) / 11);
      setStuck(tracker.waitingSeconds > STUCK_SECONDS);
      if (!found) return;
      const k = phraseRef.current.length;
      const outcome = { ...analyseSign(found.frames, size, classifier, templatesRef.current, signs[k]), joined: found.joined, start: found.start, end: found.end };
      const all = [...phraseRef.current, outcome];
      phraseRef.current = all;
      setPhraseResults(all);
      if (outcome.verdict !== "unclear") {
        save({ signId: signs[k], mode: "lesson", exercise: "phrase", phrase: cur.phrase.gloss, joined: found.joined ?? undefined,
          verdict: outcome.verdict, closeness: outcome.closeness, issues: outcome.issues, framing: framing.active });
      }
      if (all.length === signs.length) {
        const correct = all.filter((r) => r.verdict === "correct").length;
        const verdict = correct === signs.length ? "correct" : correct > 0 ? "close" : "incorrect";
        addTry(p, { verdict, signs: all, flow: phraseFlow(all, signs.map((s) => labelOf(vocab, s))) });
        if (verdict === "correct") progress.completeLesson({ key: `phrase:${cur.phrase.gloss}`, perfect: true });
        setPhase("result");
      }
      return;
    }

    // watch / recall: one attempt = raise the hand, sign, lower it
    if (entry?.tries.some((t) => t.verdict === "correct")) return; // answered: wait for Continue
    const event = recorderRef.current.push(frame);
    if (event === "started") {
      setPhase("signing");
    } else if (event?.frames) {
      const outcome = analyseSign(event.frames, size, classifier, templatesRef.current, cur.signId);
      addTry(p, { ...outcome, frames: event.frames });
      setPhase("result");
      if (outcome.verdict !== "unclear") {
        save({ signId: cur.signId, mode: "lesson", exercise: cur.type, verdict: outcome.verdict,
          closeness: outcome.closeness, issues: outcome.issues, framing: framing.active });
      }
    }
  }, {
    capture: true, // pictures for the side-by-side replay (memory only)
    onStart: () => { recorderRef.current.reset(); setPhase("waiting"); },
    log: (type) => progress.logAction(type, page),
  });

  const resetSigning = () => {
    recorderRef.current.reset();
    trackerRef.current = null;
    phraseRef.current = [];
    setPhraseResults([]);
    setStuck(false);
    setPhase("waiting");
  };

  // move on; an exercise not answered correctly comes back once at the end of the lesson
  const next = (skipped = false) => {
    const entry = entriesRef.current[pos] ?? { tries: [] };
    if (skipped) {
      const list = [...entriesRef.current];
      list[pos] = { ...entry, skipped: true };
      entriesRef.current = list;
      setEntries(list);
      progress.logAction("skip-exercise", page);
    }
    const ok = entry.tries.some((t) => t.verdict === "correct");
    if (!ok && !skipped && !ex.retry) {
      queueRef.current = [...queueRef.current, { ...ex, retry: true }];
      setQueue(queueRef.current);
    }
    resetSigning();
    setPos(pos + 1);
    if (pos + 1 >= queueRef.current.length) progress.logAction("lesson-end", page);
  };

  const answerPick = (option) => {
    if (entriesRef.current[pos]?.tries.length) return;
    const verdict = option === ex.signId ? "correct" : "incorrect";
    addTry(pos, { verdict, chosen: option });
    setPhase("result");
    save({ signId: ex.signId, mode: "lesson", exercise: ex.type, verdict });
  };

  const retryPhrase = () => {
    resetSigning();
    progress.logAction("restart", page);
  };

  if (pos >= queue.length) {
    return <LessonSummary vocab={vocab} progress={progress} plan={plan} target={target} queue={queue} entries={entries}
      bestCombo={bestCombo} seconds={(Date.now() - startedAt.current) / 1000} badgesBefore={badgesBefore} />;
  }

  const entry = entries[pos] ?? { tries: [] };
  const lastTry = entry.tries[entry.tries.length - 1] ?? null;
  const camera = CAMERA_TYPES.has(ex.type);
  const label = ex.signId ? labelOf(vocab, ex.signId) : null;
  const template = ex.signId ? templatesRef.current?.[ex.signId]?.mean : null;
  const phraseLabels = ex.phrase?.signs.map((s) => labelOf(vocab, s));
  const KICKER = {
    watch: ex.review ? "Review · copy the sign" : "New sign · watch and copy",
    recall: ex.review ? "Review · from memory" : "From memory",
    "pick-word": "Which sign is this?",
    "pick-video": "Which video shows…",
    phrase: "Use it in a phrase",
  };

  return (
    <section className="lesson">
      <header className="lesson-top">
        <a className="lesson-close" href={plan.back} aria-label="Close lesson">✕</a>
        <div className="lesson-progress" aria-label={`Exercise ${pos + 1} of ${queue.length}`}>
          <span style={{ width: `${(pos / queue.length) * 100}%` }} />
        </div>
        <span className={`combo ${combo >= 2 ? "lit" : ""}`} title="Right first time in a row" aria-label={`${combo} in a row`}>🔥 {combo}</span>
        <button type="button" className="link skip" onClick={() => next(true)}>Skip</button>
      </header>
      {toast && <p className="toast" role="status">{toast}</p>}

      <div className="prompt">
        <span className="prompt-kicker">{plan.title} · {ex.retry ? "Let's try this again" : KICKER[ex.type]}</span>
        {ex.type === "phrase" ? (
          <h2 className="phrase-prompt">
            {phraseLabels.map((l, i) => (
              <span key={i} className={`phrase-word ${phraseResults[i] ? phraseResults[i].verdict : i === phraseResults.length ? "current" : ""}`}>{l}</span>
            ))}
          </h2>
        ) : ex.type === "pick-word" ? (
          <h2>What does this sign mean?</h2>
        ) : (
          <h2>{ex.type === "pick-video" ? "Find" : "Sign"} <span className="prompt-word">{label}</span></h2>
        )}
        {ex.type === "phrase" && <p className="muted phrase-how">“{ex.phrase.english}” Sign it in one go, moving straight from one sign to the next.</p>}
      </div>

      <div className={`practice-grid ${camera ? "" : "no-camera"}`}>
        <div className="exercise-main">
          {ex.type === "watch" && <ReferencePanel signId={ex.signId} label={label} template={template} />}
          {ex.type === "recall" && (lastTry && lastTry.verdict !== "unclear"
            ? <ReferencePanel signId={ex.signId} label={label} template={template} />
            : <div className="quiz-hidden card"><span className="empty-emoji" aria-hidden="true">🤔</span>Sign it from memory. The video appears afterwards.</div>)}
          {ex.type === "phrase" && (
            <PhraseVideo signs={ex.phrase.signs} labels={phraseLabels}
              current={pipeline.detecting && phraseResults.length < ex.phrase.signs.length ? phraseResults.length : null} />
          )}
          {isPick(ex.type) && <PickExercise key={pos} ex={ex} vocab={vocab} answer={lastTry} onAnswer={answerPick} />}
        </div>
        <div className="camera-col" hidden={!camera}>
          <CameraView {...pipeline} onRestart={ex.type === "phrase" && phraseResults.length > 0 ? retryPhrase : undefined} restartLabel="Restart phrase" />
          {camera && pipeline.detecting && phase !== "result" && ex.type !== "phrase" && (
            <div className={`coach ${phase}`}>
              <span className="coach-icon" aria-hidden="true">{phase === "signing" ? "👀" : "✋"}</span>
              {phase === "signing" ? "Watching… lower your hand when you finish." : "Raise one hand, sign, then lower your hand."}
            </div>
          )}
          {ex.type === "phrase" && pipeline.detecting && phraseResults.length < ex.phrase.signs.length && (
            <div className={`coach ${handUp ? "signing" : "waiting"}`}>
              <span className="coach-icon still-ring" style={{ "--still": stillness }} aria-hidden="true">{handUp ? "👀" : "✋"}</span>
              <span>
                Sign <strong>“{phraseLabels[phraseResults.length]}”</strong>.{" "}
                {stuck ? "Not recognised yet. Hold still or lower your hand to check this sign."
                  : phraseResults.length === ex.phrase.signs.length - 1 ? "Then hold still or lower your hand." : "Then go straight into the next sign."}
              </span>
            </div>
          )}
        </div>
      </div>

      {ex.type === "phrase" && phraseResults.length > 0 && (
        <PhraseChips signs={ex.phrase.signs} labels={phraseLabels} results={phraseResults} vocab={vocab} />
      )}

      {/* result of this exercise */}
      {lastTry && (ex.type === "watch" || ex.type === "recall") && (
        <ResultSheet key={pos} result={lastTry} vocab={vocab} template={template} onContinue={() => next()} attempt={entry.tries.length}
          frames={lastTry.frames} signId={ex.signId} label={label}
          note={lastTry.verdict === "correct" ? null : "Sign it again to have another go, or continue: it will come back later."} />
      )}
      {lastTry && isPick(ex.type) && (
        <div className={`sheet ${lastTry.verdict}`} role="status">
          <div className="sheet-body">
            <div className="sheet-head">
              <span className="sheet-emoji" aria-hidden="true">{lastTry.verdict === "correct" ? "🎉" : "🤔"}</span>
              <strong className="sheet-title">{lastTry.verdict === "correct" ? "That's right!" : "Not quite"}</strong>
              {lastTry.verdict === "correct" && <span className="xp-gain">+5 XP</span>}
            </div>
            {lastTry.verdict !== "correct" && <p>The answer was “{label}”. You'll see it again at the end.</p>}
          </div>
          <div className="sheet-actions">
            <button type="button" className={`button primary ${lastTry.verdict}`} onClick={() => next()}>Continue</button>
          </div>
        </div>
      )}
      {lastTry && ex.type === "phrase" && phraseResults.length === ex.phrase.signs.length && (
        <div className={`sheet ${lastTry.verdict}`} role="status">
          <div className="sheet-body">
            <div className="sheet-head">
              <span className="sheet-emoji" aria-hidden="true">{lastTry.verdict === "correct" ? "🎉" : "💪"}</span>
              <strong className="sheet-title">
                {lastTry.verdict === "correct" ? "Whole phrase correct!" : `${lastTry.signs.filter((r) => r.verdict === "correct").length} of ${ex.phrase.signs.length} signs correct`}
              </strong>
            </div>
            {lastTry.flow && <p className="flow-summary"><strong>{lastTry.flow.title}</strong> {lastTry.flow.tip}</p>}
          </div>
          <div className="sheet-actions">
            {lastTry.verdict !== "correct" && <button type="button" className="button" onClick={retryPhrase}>Try again</button>}
            <button type="button" className={`button primary ${lastTry.verdict}`} onClick={() => next()}>Continue</button>
          </div>
        </div>
      )}
    </section>
  );
}

// Multiple choice. pick-word: a clip plays, choose the word. pick-video: a word is shown, choose
// the clip. Answer once; the right answer is then marked.
function PickExercise({ ex, vocab, answer, onAnswer }) {
  // keys 1-3 answer too
  useEffect(() => {
    if (answer) return undefined;
    const onKey = (e) => {
      const k = Number(e.key) - 1;
      if (k >= 0 && k < ex.options.length) onAnswer(ex.options[k]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, ex, onAnswer]);
  const state = (o) => !answer ? "" : o === ex.signId ? "right" : o === answer.chosen ? "wrong" : "dim";
  if (ex.type === "pick-word") {
    return (
      <div className="pick">
        <div className="pick-clip"><SignVideo signId={ex.signId} controls /></div>
        <div className="pick-options" role="group" aria-label="Choose the word">
          {ex.options.map((o, k) => (
            <button key={o} type="button" className={`pick-option ${state(o)}`} disabled={Boolean(answer)} onClick={() => onAnswer(o)}>
              <span className="pick-key" aria-hidden="true">{k + 1}</span> {labelOf(vocab, o)}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="pick-videos" role="group" aria-label="Choose the video">
      {ex.options.map((o, k) => (
        <button key={o} type="button" className={`pick-video ${state(o)}`} disabled={Boolean(answer)} onClick={() => onAnswer(o)}
          aria-label={answer ? labelOf(vocab, o) : `Video ${k + 1}`}>
          <SignVideo signId={o} />
          <span className="pick-key">{answer ? labelOf(vocab, o) : k + 1}</span>
        </button>
      ))}
    </div>
  );
}
