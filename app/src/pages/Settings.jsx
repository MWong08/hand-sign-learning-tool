// Settings, user-testing (UAT) sessions, and credits.
import { useEffect, useState } from "react";
import { getAllAttempts, getAllEvents } from "../lib/db.js";
import { usePreference } from "../components/ui.jsx";
import { downloadText } from "../lib/download.js";
import { DEFAULTS } from "../lib/prefs.js";
import { normaliseParticipantId, sessionFileName, sessionSummary, sessionToCsv } from "../lib/uat.js";

export default function Settings({ progress }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section>
      <h1>More</h1>
      <div className="link-tiles">
        <a className="mode-tile" href="#/help"><span className="mode-icon" aria-hidden="true">❓</span><span className="mode-name">Getting started</span>
          <span className="mode-desc">Camera set-up and how each mode works.</span></a>
        <a className="mode-tile" href="#/quiz"><span className="mode-icon" aria-hidden="true">🎯</span><span className="mode-name">Quiz</span>
          <span className="mode-desc">Sign words from memory.</span></a>
      </div>
      <Preferences progress={progress} />

      <h2 className="section-title">Settings</h2>

      <label className="setting">
        <input type="checkbox" checked={progress.unlockAll} onChange={(e) => progress.setUnlockAll(e.target.checked)} />
        <span>
          <strong>Unlock all units and phrases</strong>
          <span className="muted">Explore everything without completing units in order.</span>
        </span>
      </label>

      <div className="setting">
        <span>
          <strong>Reset progress</strong>
          <span className="muted">Deletes your practice history and mastered signs from this browser.</span>
        </span>
        {confirming
          ? <span><button type="button" className="button danger" onClick={() => { progress.reset(); setConfirming(false); }}>Yes, reset</button>{" "}
            <button type="button" className="button" onClick={() => setConfirming(false)}>Cancel</button></span>
          : <button type="button" className="button" onClick={() => setConfirming(true)}>Reset…</button>}
      </div>

      <UatPanel progress={progress} />

      <p className="dev-link"><a href="#/live">Developer: live recognition view</a></p>

      <h3>Privacy</h3>
      <p className="muted">
        Everything runs in your browser. Camera images are never uploaded or stored; your progress is saved only on this device.
      </p>

      <h3>Credits</h3>
      <p className="muted">
        Sign videos and training data: PopSign ASL v1.0 (Georgia Tech / Deaf Professional Arts Network), licensed
        CC BY 4.0, https://signdata.cc.gatech.edu. Hand and pose tracking: Google MediaPipe. Recognition: TensorFlow.js.
      </p>
    </section>
  );
}

// Profile preferences (lib/prefs.js). Changes apply straight away, on every screen; in a UAT
// session each change is logged (e.g. "pref:hand=left"), to see which ones testers used.
function Preferences({ progress }) {
  const pref = (key) => {
    const [value, set] = usePreference(key, DEFAULTS[key]); // eslint-disable-line react-hooks/rules-of-hooks -- same keys every render
    return [value, (v) => { set(v); progress.logAction(`pref:${key}=${v}`, "settings"); }];
  };
  const [hand, setHand] = pref("hand");
  const [autoStart, setAutoStart] = pref("autoStart");
  const [countdown, setCountdown] = pref("countdown");
  const [theme, setTheme] = pref("theme");
  const [textSize, setTextSize] = pref("textSize");
  return (
    <>
      <h2 className="section-title">Your preferences</h2>
      <div className="setting">
        <span>
          <strong>Dominant hand</strong>
          <span className="muted">The hand you sign with. Left flips the demo videos and hand drawings so they use your hand. Recognition works with either.</span>
        </span>
        <Choice label="Dominant hand" value={hand} onChange={setHand} options={[["right", "✋ Right"], ["left", "🤚 Left"]]} />
      </div>
      <label className="setting">
        <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
        <span>
          <strong>Start the camera automatically</strong>
          <span className="muted">Skip the Start button: signs are watched for as soon as the camera is on, and free signing opens with the camera on.</span>
        </span>
      </label>
      <label className="setting">
        <input type="checkbox" checked={countdown} onChange={(e) => setCountdown(e.target.checked)} />
        <span>
          <strong>Countdown before each attempt</strong>
          <span className="muted">“3, 2, 1” before the app starts watching, so you have time to get ready.</span>
        </span>
      </label>
      <div className="setting">
        <span><strong>Theme</strong><span className="muted">“System” follows your device.</span></span>
        <Choice label="Theme" value={theme} onChange={setTheme} options={[["system", "System"], ["light", "☀️ Light"], ["dark", "🌙 Dark"]]} />
      </div>
      <div className="setting">
        <span><strong>Text size</strong><span className="muted">Makes all text bigger.</span></span>
        <Choice label="Text size" value={textSize} onChange={setTextSize} options={[["normal", "A"], ["large", "A+"], ["larger", "A++"]]} />
      </div>
    </>
  );
}

// a row of buttons, one of them on
function Choice({ label, value, onChange, options }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

// For the researcher running a UAT session, not for learners.
function UatPanel({ progress }) {
  const { uatSession, lastUatSession } = progress;
  const [code, setCode] = useState("");
  const [fresh, setFresh] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);

  // live numbers for the running session (or the last one)
  const shown = uatSession ?? lastUatSession;
  useEffect(() => {
    if (!shown) return;
    getAllAttempts().then((a) => setSummary(sessionSummary(shown, a, shown.endedAt ?? Date.now()))).catch(() => {});
  }, [shown, progress.records]);

  const start = async () => {
    const id = normaliseParticipantId(code);
    if (!id) {
      setError("Use a participant code such as P01 (letters then numbers), not a name.");
      return;
    }
    setError(null);
    await progress.startUatSession(id, { fresh });
    setCode("");
  };

  const download = async (session) => {
    const [attempts, events] = await Promise.all([getAllAttempts(), getAllEvents()]);
    downloadText(sessionFileName(session), sessionToCsv(session, attempts, events));
  };

  const end = async () => {
    const ended = await progress.endUatSession();
    if (ended) await download(ended);
  };

  return (
    <div className="uat-panel">
      <h3>User testing (UAT)</h3>
      {uatSession ? (
        <>
          <p>
            Session running for <strong>{uatSession.participantId}</strong>, started{" "}
            {new Date(uatSession.startedAt).toLocaleTimeString([], { timeStyle: "short" })}.
            Attempts and screens visited are being logged.
          </p>
          {summary && <SummaryLine s={summary} />}
          <p><button type="button" className="button primary" onClick={end}>End session and download data</button></p>
        </>
      ) : (
        <>
          <p className="muted">
            For the researcher. Start a session before each participant: their attempts and the screens they visit
            are logged under a participant code, and one CSV is downloaded when the session ends.
          </p>
          <div className="uat-start">
            <label>
              Participant code
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="P01" maxLength={8}
                onKeyDown={(e) => e.key === "Enter" && start()} />
            </label>
            <button type="button" className="button primary" onClick={start}>Start session</button>
          </div>
          <label className="setting">
            <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
            <span>
              <strong>Start from fresh progress</strong>
              <span className="muted">
                Clears this browser's progress, so the participant starts at Unit 1
                {lastUatSession && <> (and deletes {lastUatSession.participantId}'s logged data: download it first)</>}.
              </span>
            </span>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          {lastUatSession && (
            <p className="muted">
              Last session: <strong>{lastUatSession.participantId}</strong>
              {summary && <> · <SummaryLine s={summary} inline /></>}{" "}
              <button type="button" className="link" onClick={() => download(lastUatSession)}>Download again</button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SummaryLine({ s, inline }) {
  const text = `${s.minutes} min · ${s.attempts} attempts on ${s.signsTried} signs` +
    (s.attempts ? ` · ${s.accuracy}% correct · camera set-up problems in ${s.badFramingShare}% of attempts` : "");
  return inline ? <span>{text}</span> : <p className="muted">{text}</p>;
}
