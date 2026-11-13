// "Ghost hand": an animated skeleton of how the sign is performed, drawn straight from the sign's
// template (the average of the training signers' features, public/models/templates.json), with
// the learner's own attempt drawn over it and the part the diagnosis flagged highlighted.
//
// The features are body-relative (lib/preprocess.js): per frame, the hand's 20 joints relative to
// the wrist (in hand sizes), the wrist relative to the shoulder midpoint and to the nose (in
// shoulder widths). That is enough to redraw the hand, the shoulders and the face. The hand's
// size relative to the shoulders is not stored, so it is drawn at a fixed typical scale.
// Drawn mirrored, like the camera view, so it matches what the learner sees of themselves.
import { useEffect, useRef } from "react";
import { FINGERS } from "../lib/diagnose.js";

const HAND_SCALE = 0.42;  // drawn hand size (wrist to middle knuckle) in shoulder widths (a little larger than life, to read the shape)
const VIEW = { left: -1.2, right: 1.2, top: -1.6, bottom: 0.8 }; // shoulder widths around the shoulder midpoint
const FPS = 8;            // slower than real time (15 fps), so the shape is easy to follow
const HOLD_FRAMES = 6;    // pause on the last frame before looping
export const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
const PALM = new Set(["5-9", "9-13", "13-17", "0-17", "0-5"]);
// finger of a bone (by its outer joint), or null for the palm
export const fingerOf = ([a, b]) => (PALM.has(`${a}-${b}`) ? null : FINGERS[Math.floor((b - 1) / 4)]);

const COLORS = { body: "#cbd5e1", sign: "#16a34a", you: "#f97316", flag: "#dc2626", path: "#86efac" };

// one frame of features -> { wrist: [x, y], joints: [[x, y] x 21], nose: [x, y] } in shoulder widths
function pose(row, mirror) {
  const sx = mirror ? -1 : 1;
  const wrist = [sx * row[60], row[61]];
  const joints = [wrist];
  for (let j = 0; j < 20; j++) joints.push([wrist[0] + sx * row[j * 3] * HAND_SCALE, wrist[1] + row[j * 3 + 1] * HAND_SCALE]);
  return { wrist, joints, nose: [sx * (row[60] - row[62]), row[61] - row[63]] };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export default function GhostHand({ template, attempt = null, issues = [], mirror = true, size = 260, label }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !template) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    const unit = (size * dpr) / (VIEW.right - VIEW.left);
    const px = ([x, y]) => [(x - VIEW.left) * unit, (y - VIEW.top) * unit];

    const sign = template.map((row) => pose(row, mirror));
    const you = attempt?.map((row) => pose(row, mirror)) ?? null;
    const nose = [median(sign.map((p) => p.nose[0])), median(sign.map((p) => p.nose[1]))];
    const flagged = new Set(issues.map((i) => i.component));

    const line = (a, b, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * dpr;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(...px(a));
      ctx.lineTo(...px(b));
      ctx.stroke();
    };
    const hand = (p, color, width, alpha, highlightFingers) => {
      ctx.globalAlpha = alpha;
      for (const bone of BONES) {
        const f = fingerOf(bone);
        const hl = f && highlightFingers && flagged.has(f);
        line(p.joints[bone[0]], p.joints[bone[1]], hl ? COLORS.flag : color, hl ? width * 1.8 : width);
      }
      ctx.globalAlpha = 1;
    };

    const draw = (t) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // body: head, neck, shoulders, upper torso
      ctx.fillStyle = COLORS.body;
      ctx.beginPath();
      ctx.arc(...px(nose), 0.32 * unit, 0, 2 * Math.PI);
      ctx.fill();
      line([nose[0], nose[1] + 0.3], [0, 0], COLORS.body, 10);
      line([-0.5, 0], [0.5, 0], COLORS.body, 12);
      line([-0.5, 0], [-0.45, 0.9], COLORS.body, 10);
      line([0.5, 0], [0.45, 0.9], COLORS.body, 10);

      // where the sign is made: the template wrist path (always shown faintly; bold if flagged)
      const pathFlag = flagged.has("movement") || flagged.has("position");
      ctx.globalAlpha = pathFlag ? 0.9 : 0.35;
      for (let k = 1; k < sign.length; k++) line(sign[k - 1].wrist, sign[k].wrist, pathFlag ? COLORS.flag : COLORS.path, pathFlag ? 4 : 3);
      ctx.globalAlpha = 1;

      if (you) hand(you[t], COLORS.you, 3, 0.75, false);
      hand(sign[t], COLORS.sign, 4, 1, true);
    };

    let frame = 0;
    let last = 0;
    let raf;
    const total = sign.length + HOLD_FRAMES;
    const loop = (now) => {
      if (now - last >= 1000 / FPS) {
        last = now;
        draw(Math.min(frame, sign.length - 1));
        frame = (frame + 1) % total;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [template, attempt, issues, mirror, size]);

  return (
    <figure className="ghost">
      <canvas ref={canvasRef} style={{ width: size, height: size }} role="img"
        aria-label={label ?? "Animated hand skeleton of the sign"} />
      <figcaption className="ghost-legend">
        <span><i style={{ background: COLORS.sign }} /> The sign</span>
        {attempt && <span><i style={{ background: COLORS.you }} /> You</span>}
        {issues.length > 0 && <span><i style={{ background: COLORS.flag }} /> Fix this</span>}
      </figcaption>
    </figure>
  );
}
