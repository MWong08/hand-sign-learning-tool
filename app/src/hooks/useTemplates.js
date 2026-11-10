// The diagnostic templates (public/models/templates.json), loaded once and kept in a ref so the
// camera loop can read them without re-rendering. The component also re-renders once they have
// loaded, so screens can draw from them (the hand-skeleton views).
import { useEffect, useRef, useState } from "react";
import { loadTemplates } from "../lib/diagnose.js";

export function useTemplates() {
  const ref = useRef(null);
  const [, setLoaded] = useState(false);
  useEffect(() => {
    loadTemplates().then((t) => { ref.current = t; setLoaded(true); }).catch(() => {});
  }, []);
  return ref;
}
