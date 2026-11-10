// Pause mode (pause or lower the hand between signs: the most accurate) or fluent mode (sign
// straight through: sliding-window recognition, lib/fluent.js). Remembered per browser.
import { usePreference } from "./ui.jsx";

export function useSigningMode() {
  return usePreference("signing-mode", "pause");
}

export default function ModeSwitch({ mode, onChange }) {
  return (
    <div className="mode-switch">
      <div className="segmented" role="radiogroup" aria-label="How you sign">
        <button type="button" role="radio" aria-checked={mode === "pause"} className={mode === "pause" ? "on" : ""} onClick={() => onChange("pause")}>
          ⏸ Pause between signs
        </button>
        <button type="button" role="radio" aria-checked={mode === "fluent"} className={mode === "fluent" ? "on" : ""} onClick={() => onChange("fluent")}>
          🌊 Fluent <span className="beta">beta</span>
        </button>
      </div>
      <p className="muted mode-help">
        {mode === "pause"
          ? "Hold your hand still for half a second, or lower it, after each sign. Most accurate."
          : "Sign straight through without stopping, like a fluent signer. Each sign appears about half a second after you make it."}
      </p>
    </div>
  );
}
