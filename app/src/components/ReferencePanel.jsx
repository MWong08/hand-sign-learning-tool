// How to sign it: the reference clip (with slow motion / mirror), or the animated hand skeleton
// drawn from the sign's template, which shows the hand shape and path without the video's noise.
import { useState } from "react";
import GhostHand from "./GhostHand.jsx";
import { SignVideo } from "./ui.jsx";

export default function ReferencePanel({ signId, label, template }) {
  const [view, setView] = useState("video");
  return (
    <figure className="reference card">
      <div className="segmented" role="tablist" aria-label="How to sign it">
        <button type="button" role="tab" aria-selected={view === "video"} className={view === "video" ? "on" : ""} onClick={() => setView("video")}>
          🎬 Video
        </button>
        <button type="button" role="tab" aria-selected={view === "skeleton"} className={view === "skeleton" ? "on" : ""}
          onClick={() => setView("skeleton")} disabled={!template}>
          🦴 Hand shape
        </button>
      </div>
      {view === "video" || !template
        ? <SignVideo key={signId} signId={signId} controls />
        : <GhostHand template={template} label={`Animated hand skeleton of ${label}`} />}
      <figcaption>
        {view === "video"
          ? <>How to sign <strong>{label}</strong>. Clip: PopSign ASL v1.0 (Georgia Tech / DPAN), CC BY 4.0</>
          : <>The average of many Deaf signers, slowed down and mirrored like your camera.</>}
      </figcaption>
    </figure>
  );
}
