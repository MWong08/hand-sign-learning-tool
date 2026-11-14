import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { applyDisplayPrefs } from "./lib/prefs.js";

applyDisplayPrefs(); // theme and text size before the first paint, so the page doesn't flash

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
