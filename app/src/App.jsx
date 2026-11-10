// App shell: loads the vocabulary and the learner's progress, then shows the screen named in
// the URL hash (#/unit/2, #/practice/2/3, #/phrase/1, ...).
import { useEffect, useState } from "react";
import { useHashRoute } from "./hooks/useHashRoute.js";
import { useProgress } from "./hooks/useProgress.js";
import { loadVocabulary } from "./lib/vocabulary.js";
import FreeSigning from "./pages/FreeSigning.jsx";
import Help from "./pages/Help.jsx";
import Home from "./pages/Home.jsx";
import LiveRecognition from "./pages/LiveRecognition.jsx";
import PhraseList from "./pages/PhraseList.jsx";
import PhrasePractice from "./pages/PhrasePractice.jsx";
import Practice from "./pages/Practice.jsx";
import ProgressPage from "./pages/ProgressPage.jsx";
import Quiz from "./pages/Quiz.jsx";
import Settings from "./pages/Settings.jsx";
import UnitPage from "./pages/UnitPage.jsx";
import "./App.css";

export default function App() {
  const [vocab, setVocab] = useState(null);
  const progress = useProgress();
  const route = useHashRoute();

  useEffect(() => {
    loadVocabulary().then(setVocab);
  }, []);

  // UAT mode: log every screen the participant visits (lib/uat.js)
  const path = [route.name, ...route.params].join("/");
  const { logPage, uatSession } = progress;
  useEffect(() => {
    if (uatSession) logPage(path);
  }, [path, uatSession, logPage]);

  if (!vocab || !progress.loaded) return <main className="app loading-screen"><span className="brand-mark big" aria-hidden="true">🤟</span><p>Loading…</p></main>;

  const [a, b] = route.params.map(Number);
  const valid = (i, list) => Number.isInteger(i) && i >= 0 && i < list.length;
  let page;
  switch (route.name) {
    case "unit":
      page = valid(a, vocab.units) && <UnitPage key={a} vocab={vocab} unitIndex={a} progress={progress} />;
      break;
    case "practice":
      page = valid(a, vocab.units) && valid(b, vocab.units[a].signs) &&
        <Practice key={`${a}-${b}`} vocab={vocab} unitIndex={a} signIndex={b} progress={progress} />;
      break;
    case "phrases":
      page = <PhraseList vocab={vocab} progress={progress} />;
      break;
    case "phrase":
      page = valid(a, vocab.phrases) && <PhrasePractice key={a} vocab={vocab} phraseIndex={a} progress={progress} />;
      break;
    case "free":
      page = <FreeSigning vocab={vocab} />;
      break;
    case "quiz":
      page = <Quiz key={route.params.join("/")} vocab={vocab} progress={progress} />;
      break;
    case "progress":
      page = <ProgressPage vocab={vocab} progress={progress} />;
      break;
    case "help":
      page = <Help />;
      break;
    case "settings":
      page = <Settings progress={progress} />;
      break;
    case "live":
      page = <LiveRecognition vocab={vocab} />;
      break;
    default:
      page = <Home vocab={vocab} progress={progress} />;
  }

  // lesson screens hide the navigation so the learner can focus (education-app "lesson mode")
  const lesson = ["practice", "phrase", "quiz"].includes(route.name) && Boolean(page);
  const g = progress.game;

  return (
    <div className={`shell ${lesson ? "lesson-mode" : ""}`}>
      {!lesson && <NavTabs current={route.name} />}
      <main className="app">
        {!lesson && (
          <header className="statbar">
            <a className="brand" href="#/"><span className="brand-mark" aria-hidden="true">🤟</span> Sign Practice</a>
            <span className="stat-pills">
              <span className={`pill streak ${g.practisedToday ? "lit" : ""}`} title={`${g.streak}-day streak`}>
                <span aria-hidden="true">🔥</span> {g.streak}<span className="sr-only"> day streak</span>
              </span>
              <span className="pill xp" title="Total XP"><span aria-hidden="true">⚡</span> {g.xp}<span className="sr-only"> XP</span></span>
              <GoalRing value={g.todayXp} goal={g.goal} />
            </span>
          </header>
        )}
        {progress.uatSession && (
          <p className="uat-banner" role="status">
            User testing session · participant <strong>{progress.uatSession.participantId}</strong>
            {route.name !== "settings" && <> · <a href="#/settings">End session</a></>}
          </p>
        )}
        {page || <p>Page not found. <a href="#/">Go home</a></p>}
      </main>
    </div>
  );
}

const TABS = [
  { route: "home", href: "#/", icon: "🏠", label: "Learn", also: ["unit"] },
  { route: "phrases", href: "#/phrases", icon: "💬", label: "Phrases", also: [] },
  { route: "free", href: "#/free", icon: "✋", label: "Free sign", also: [] },
  { route: "progress", href: "#/progress", icon: "📊", label: "Progress", also: [] },
  { route: "settings", href: "#/settings", icon: "⚙️", label: "More", also: ["help", "live"] },
];

// bottom tab bar on phones, sidebar on wide screens
function NavTabs({ current }) {
  return (
    <nav className="tabs" aria-label="Main">
      <a className="tabs-brand" href="#/"><span aria-hidden="true">🤟</span> Sign Practice</a>
      {TABS.map((t) => {
        const active = t.route === current || t.also.includes(current);
        return (
          <a key={t.route} href={t.href} className={`tab ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
            <span className="tab-icon" aria-hidden="true">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

// today's XP towards the daily goal, as a small ring
function GoalRing({ value, goal }) {
  const pct = Math.min(1, value / goal);
  const r = 14, c = 2 * Math.PI * r;
  return (
    <span className={`pill goal ${pct >= 1 ? "met" : ""}`} title={`Daily goal: ${value} of ${goal} XP`}>
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <circle cx="17" cy="17" r={r} className="ring-track" />
        <circle cx="17" cy="17" r={r} className="ring-fill" strokeDasharray={`${pct * c} ${c}`} transform="rotate(-90 17 17)" />
        <text x="17" y="21" textAnchor="middle">{pct >= 1 ? "✓" : "🎯"}</text>
      </svg>
      <span className="sr-only">Daily goal {value} of {goal} XP</span>
    </span>
  );
}
