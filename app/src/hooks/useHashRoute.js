// Minimal hash routing: the screen lives in the URL (#/unit/2, #/practice/2/3, ...), so the
// browser's back button and page refresh work, without a routing library.
import { useEffect, useState } from "react";

function parse() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { name: parts[0] ?? "home", params: parts.slice(1) };
}

export function useHashRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export const navigate = (...parts) => {
  window.location.hash = `#/${parts.join("/")}`;
};
