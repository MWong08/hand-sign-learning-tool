// Quiz (IR FR5): sign each word from memory. The reference clip is only shown after answering.
// Questions come from the unlocked units; answers are saved like practice attempts (mode "quiz").
//
// State: question number `i` and `phase` ("asking" -> "answered" -> next question). The camera
// loop reads them through a ref, because frames arrive faster than React re-renders.
import { useMemo, useRef, useState } from "react";
import CameraView from "../components/CameraView.jsx";
import ReferencePanel from "../components/ReferencePanel.jsx";
import ResultSheet from "../components/ResultSheet.jsx";
import { useSignPipeline } from "../hooks/useSignPipeline.js";
import { useTemplates } from "../hooks/useTemplates.js";
import { analyseSign } from "../lib/judgeSign.js";
import { createAttemptRecorder } from "../lib/attempt.js";
import { xpFor } from "../lib/gamify.js";
import { isUnitUnlocked } from "../lib/progress.js";
import { buildQuiz, scoreQuiz } from "../lib/quiz.js";
import { labelOf } from "../lib/vocabulary.js";

export default function Quiz({ vocab, progress }) {
  const pool = useMemo(() => vocab.units
    .filter((_, k) => isUnitUnlocked(vocab.units, k, progress.records, progress.unlockAll))
    .flatMap((u) => u.signs.map((s) => s.id)), [vocab, progress.records, progress.unlockAll]);

  const [questions, setQuestions] = useState(() => buildQuiz(pool));
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState("asking"); // asking | answered
  const [answers, setAnswers] = useState([]);
  const [signing, setSigning] = useState(false);
  const recorderRef = useRef(createAttemptRecorder());
  const stateRef = useRef({ i: 0, phase: "asking" });
  const templatesRef = useTemplates();

  const go = (nextI, nextPhase) => {
    stateRef.current = { i: nextI, phase: nextPhase };
    setI(nextI);
    setPhase(nextPhase);
  };

  const pipeline = useSignPipeline((frame, size, classifier, framing) => {
    const { i: q, phase: p } = stateRef.current;
    if (p !== "asking" || q >= questions.length) return;
    const event = recorderRef.current.push(frame);
    if (event === "started") setSigning(true);
    if (!event?.frames) return;
    setSigning(false);
    const target = questions[q];
    const outcome = analyseSign(event.frames, size, classifier, templatesRef.current, target);
    setAnswers((a) => [...a, { signId: target, ...outcome }]);
    go(q, "answered");
    if (outcome.verdict !== "unclear") {
      progress.record({ signId: target, mode: "quiz", verdict: outcome.verdict, closeness: outcome.closeness, issues: outcome.issues, framing: framing.active });
    }
  });

  const next = () => {
    recorderRef.current.reset();
    go(i + 1, "asking");
  };
  const restart = () => {
    recorderRef.current.reset();
    setQuestions(buildQuiz(pool));
    setAnswers([]);
    go(0, "asking");
  };

  if (pool.length < 3) {
    return (
      <section className="empty-state">
        <span className="empty-emoji" aria-hidden="true">🎯</span>
        <h2>Quiz</h2>
        <p>Unlock a unit first.</p>
        <a className="button primary" href="#/">Back to the path</a>
      </section>
    );
  }

  // finished: past the last question
  if (i >= questions.length) {
    const s = scoreQuiz(answers);
    const perfect = s.correct === s.total;
    return (
      <section className="empty-state quiz-done">
        <span className="empty-emoji" aria-hidden="true">{perfect ? "🏆" : s.correct >= s.total / 2 ? "🎉" : "💪"}</span>
        <h2>Quiz complete!</h2>
        <div className="result-tiles">
          <div className="tile green"><span>Correct</span><strong>{s.correct} / {s.total}</strong></div>
          <div className="tile blue"><span>Closeness</span><strong>{s.averageCloseness}%</strong></div>
          <div className="tile purple"><span>XP earned</span><strong>+{answers.reduce((n, a) => n + xpFor(a), 0)}</strong></div>
        </div>
        {s.toReview.length > 0 && (
          <>
            <h3>Worth practising again</h3>
            <p className="review-chips">{s.toReview.map((id) => <span key={id} className="chip">{labelOf(vocab, id)}</span>)}</p>
          </>
        )}
        <p className="celebrate-actions">
          <button type="button" className="button primary" onClick={restart}>New quiz</button>
          <a className="button" href="#/">Back to the path</a>
        </p>
      </section>
    );
  }

  const signId = questions[i];
  const answer = phase === "answered" ? answers[answers.length - 1] : null;
  const template = templatesRef.current?.[signId]?.mean;

  return (
    <section className="lesson">
      <header className="lesson-top">
        <a className="lesson-close" href="#/" aria-label="Close quiz">✕</a>
        <div className="lesson-progress quiz" aria-label={`Question ${i + 1} of ${questions.length}`}>
          <span style={{ width: `${(i / questions.length) * 100}%` }} />
        </div>
        <span className="muted lesson-count">{i + 1}/{questions.length}</span>
      </header>
      <div className="prompt">
        <span className="prompt-kicker">Quiz · from memory</span>
        <h2>Sign <span className="prompt-word">{labelOf(vocab, signId)}</span></h2>
      </div>
      <div className="practice-grid">
        {answer
          ? <ReferencePanel signId={signId} label={labelOf(vocab, signId)} template={template} />
          : <div className="quiz-hidden card"><span className="empty-emoji" aria-hidden="true">🤔</span>Sign it from memory. The answer appears afterwards.</div>}
        <div>
          <CameraView {...pipeline} />
          {pipeline.status === "ready" && !answer && (
            <div className={`coach ${signing ? "signing" : "waiting"}`}>
              <span className="coach-icon" aria-hidden="true">{signing ? "👀" : "✋"}</span>
              {signing ? "Watching… lower your hand when you finish." : "Raise one hand, sign, then lower your hand."}
            </div>
          )}
        </div>
      </div>
      {answer && (
        <ResultSheet result={answer} vocab={vocab} template={template} onContinue={next}
          continueLabel={i + 1 < questions.length ? "Next question" : "See results"} />
      )}
    </section>
  );
}
