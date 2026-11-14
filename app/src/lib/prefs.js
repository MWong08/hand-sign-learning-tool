// Learner preferences, remembered per browser (localStorage; it may be unavailable, e.g. in a
// private window, and then the defaults are used). These are viewer conveniences, so they are not
// part of the saved progress (IndexedDB) and are not reset with it.
//
// Profile preferences (Settings, "Your preferences"):
//   hand       "right" | "left": the learner's dominant hand. Left flips the reference videos and
//              the hand-skeleton drawings, so the demo signer uses the same hand as the learner.
//              Recognition needs no change: preprocessing already mirrors whichever hand signs
//              onto one side (preprocess.js dominantHand), as in training.
//   autoStart  start recognising as soon as the camera is ready (no Start button), and open
//              free signing with the camera on.
//   countdown  a 3-2-1 countdown before each attempt (useSignPipeline).
//   theme      "system" | "light" | "dark".
//   textSize   "normal" | "large" | "larger".
// Others, set where they are used: video-speed, video-mirror, phrase-video, tts-loop.

export const DEFAULTS = { hand: "right", autoStart: false, countdown: false, theme: "system", textSize: "normal" };
export const TEXT_SIZES = { normal: "100%", large: "112.5%", larger: "125%" };
const EVENT = "pref-change";

export function getPref(key, initial = DEFAULTS[key]) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? initial;
  } catch {
    return initial;
  }
}

// save and tell every screen using the same preference (usePreference listens)
export function setPref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable: kept for this page only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value } }));
  if (key === "theme" || key === "textSize") applyDisplayPrefs();
}

export function onPrefChange(listener) {
  const handler = (e) => listener(e.detail.key, e.detail.value);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

// theme and text size act on the whole page (App.css reads data-theme; sizes are in rem)
export function applyDisplayPrefs() {
  const root = document.documentElement;
  const theme = getPref("theme");
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
  root.style.fontSize = TEXT_SIZES[getPref("textSize")] ?? TEXT_SIZES.normal;
}
