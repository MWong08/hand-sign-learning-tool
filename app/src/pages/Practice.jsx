// Practice one target sign (IR FR1 real-time feedback, FR2 diagnostic feedback, FR3 reference
// media, FR6 progress), as an education-app "lesson": close button and unit progress at the top,
// the prompt, the reference (video or hand skeleton) next to the camera, and a coloured result
// sheet. Flow: watch -> raise hand and sign -> lower hand -> verdict + closeness + what to fix.
// Each attempt is saved; MASTERY_STREAK correct attempts in a row master the sign, and mastering
// every sign in a unit unlocks the next unit.
import { useRef, useState } from "react";
import CameraView from "../components/CameraView.jsx";
import Celebration from "../components/Celebration.jsx";
import ReferencePanel from "../components/ReferencePanel.jsx";
import ResultSheet from "../components/ResultSheet.jsx";
import { navigate } from "../hooks/useHashRoute.js";
import { keepDetectingOnNextScreen, useSignPipeline } from "../hooks/useSignPipeline.js";
import { useTemplates } from "../hooks/useTemplates.js";
import { createAttemptRecorder } from "../lib/attempt.js";
import { analyseSign } from "../lib/judgeSign.js";
import { MASTERY_STREAK, unitStatus } from "../lib/progress.js";

export default function Practice({ vocab, unitIndex, signIndex, progress }) {
  const unit = vocab.units[unitIndex];
  const sign = unit.signs[signIndex];
  const recorderRef = useRef(createAttemptRecorder());
  const templatesRef = useTemplates();
  const [phase, setPhase] = useState("waiting"); // waiting | signing | result
  const [result, setResult] = useState(null);
  const [attemptNo, setAttemptNo] = useState(0);
  const [celebrate, setCelebrate] = useState(null); // "sign" | "unit"
  const here = `practice/${unitIndex}/${signIndex}`; // this screen, for UAT logging

  const pipeline = useSignPipeline((frame, size, classifier, framing) => {
    const event = recorderRef.current.push(frame);
    if (event === "started") {
      setPhase("signing");
    } else if (event?.frames) {
      const outcome = analyseSign(event.frames, size, classifier, templatesRef.current, sign.id);
      setResult(outcome);
      setAttemptNo((n) => n + 1);
      setPhase("result");
      if (outcome.verdict !== "unclear") {
        progress.record({ signId: sign.id, mode: "practice", verdict: outcome.verdict,
          closeness: outcome.closeness, issues: outcome.issues, framing: framing.active }).then(({ newlyMastered }) => {
          if (!newlyMastered) return;
          const after = { ...progress.records, [sign.id]: { mastered: true } };
          setCelebrate(unitStatus(unit, after).complete ? "unit" : "sign");
        });
      }
    }
  }, {
    // a fresh start never continues a half-recorded attempt
    onStart: () => { recorderRef.current.reset(); setPhase("waiting"); },
    log: (type) => progress.logAction(type, here),
  });
  const restartAttempt = () => {
    recorderRef.current.reset();
    setResult(null);
    setPhase("waiting");
    pipeline.countdown();
    progress.logAction("restart", here);
  };

  const record = progress.records[sign.id];
  const status = unitStatus(unit, progress.records);
  const last = signIndex === unit.signs.length - 1;
  const next = () => {
    if (last) return navigate("unit", unitIndex);
    if (pipeline.detecting) keepDetectingOnNextScreen(); // no need to press Start again for the next sign
    navigate("practice", unitIndex, signIndex + 1);
  };
  const template = templatesRef.current?.[sign.id]?.mean;
  const streakLeft = record?.mastered ? 0 : Math.max(0, MASTERY_STREAK - (record?.streak ?? 0));

  return (
    <section className="lesson">
      <header className="lesson-top">
        <a className="lesson-close" href={`#/unit/${unitIndex}`} aria-label="Close lesson">✕</a>
        <div className="lesson-progress" aria-label={`${status.mastered} of ${status.total} signs in this unit mastered`}>
          <span style={{ width: `${(status.mastered / status.total) * 100}%` }} />
        </div>
        <button type="button" className="link skip" onClick={next}>{last ? "Finish" : "Skip"}</button>
      </header>

      <div className="prompt">
        <span className="prompt-kicker">{unit.title} · sign {signIndex + 1} of {unit.signs.length}</span>
        <h2>Sign <span className="prompt-word">{sign.label}</span></h2>
        <p className="mastery-dots" aria-label={record?.mastered ? "Mastered" : `${streakLeft} more correct in a row to master`}>
          {record?.mastered
            ? <span className="badge mastered">★ Mastered</span>
            : <>{Array.from({ length: MASTERY_STREAK }, (_, k) => (
              <span key={k} className={`dot ${k < (record?.streak ?? 0) ? "on" : ""}`} />
            ))} <span className="muted">{streakLeft} more correct in a row to master</span></>}
        </p>
      </div>

      <div className="practice-grid">
        <ReferencePanel signId={sign.id} label={sign.label} template={template} />
        <div>
          <CameraView {...pipeline} onRestart={restartAttempt} restartLabel="Restart attempt" />
          {pipeline.detecting && (phase === "signing" || !result) && (
            <div className={`coach ${phase}`}>
              <span className="coach-icon" aria-hidden="true">{phase === "signing" ? "👀" : "✋"}</span>
              {phase === "signing" ? "Watching… lower your hand when you finish." : "Raise one hand, sign, then lower your hand."}
            </div>
          )}
        </div>
      </div>

      {/* the last result stays up while the learner tries again, until a new result replaces it */}
      {result && (
        <ResultSheet result={result} vocab={vocab} template={template} onContinue={next} attempt={attemptNo}
          continueLabel={last ? "Finish unit" : "Continue"} note="Or sign it again to have another go." />
      )}
      {celebrate && (
        <Celebration kind={celebrate} sign={sign.label} unitIndex={unitIndex} vocab={vocab}
          onClose={() => setCelebrate(null)} onNext={next} />
      )}
    </section>
  );
}
