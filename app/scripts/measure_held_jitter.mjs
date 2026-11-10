// Records how a HELD hand's landmarks jitter in the app's own live pipeline (2026-11-11), to
// test pause detection realistically: a frozen frame always passed, a live webcam did not.
//
// For each sign, a frame with the hand up (1.2 s before the end of its reference clip) is
// played as Chrome's fake camera for 5 s, in two versions:
//   noise  camera sensor noise only (a perfectly still hand)
//   sway   noise plus a slow ~1-2 px sway (a person trying to hold still)
// and run through the app's MediaPipe set-up (src/lib/landmarks.js, GPU) at 15 fps.
// Saves the landmarks to model/data/processed/held_hands_browser.json (used by
// model/src/calibrate_pause.py and make_phrase_eval.py) and prints per-frame movement against
// the OLD per-frame stillness limits.
//
// Needs the dev server (npm run dev, port in PORT, default 5173) and ffmpeg in FFMPEG.
// Run from app/:  FFMPEG=... node scripts/measure_held_jitter.mjs
// (Don't edit src/ while it runs: the dev server reloads the page and the run fails.)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const PORT = process.env.PORT ?? 5173;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.resolve("../model/data/processed/held_hands_browser.json");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "held-"));
const SIGNS = ["hello", "dog", "hungry", "happy", "mom", "where", "who", "bye", "thankyou", "home", "sleep", "drink",
  "thirsty", "grandma", "tomorrow", "yourself", "minemy", "dad", "water", "cat", "see", "like", "no", "yes"];
const VARIANTS = {
  noise: "noise=alls=6:allf=t",
  sway: "noise=alls=6:allf=t,crop=iw-6:ih-6:x='3+1.2*sin(t*5)+0.6*sin(t*13)':y='3+1.2*cos(t*4)+0.6*sin(t*11)',scale=360:480",
};
const FRAMES = 64;

async function record(video) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video}`] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
    return await page.evaluate(async (n) => {
      const L = await import("/src/lib/landmarks.js");
      const lm = await L.createLandmarkers();
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 360, height: 480 } });
      await v.play();
      const frames = [];
      const t0 = performance.now();
      while (frames.length < n + 6) {
        await new Promise((r) => setTimeout(r, 66));
        frames.push(L.detectFrame(lm, v, performance.now() - t0 + 1));
      }
      return { frames: frames.slice(6), width: v.videoWidth, height: v.videoHeight }; // skip tracker warm-up
    }, FRAMES);
  } finally {
    await browser.close();
  }
}

const held = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
for (const sign of SIGNS) {
  const png = path.join(tmp, `${sign}.png`);
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-sseof", "-1.2", "-i", `public/reference/${sign}.mp4`, "-frames:v", "1", png]);
  for (const [name, vf] of Object.entries(VARIANTS)) {
    if (held[name]?.some((r) => r.sign === sign)) continue; // already recorded
    const video = path.join(tmp, `${sign}-${name}.y4m`);
    execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-loop", "1", "-i", png, "-t", "6", "-r", "30",
      "-vf", `scale=360:480,${vf},format=yuv420p`, video]);
    let r = null;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      try { r = await record(video); } catch (e) { console.log(sign, name, "failed:", e.message.split("\n")[0]); }
    }
    if (!r) continue;
    const handFrames = r.frames.filter((f) => f.hands.some(Boolean)).length;
    console.log(`${sign.padEnd(9)} ${name.padEnd(6)} hand in ${handFrames}/${r.frames.length} frames`);
    if (handFrames === r.frames.length) {
      (held[name] ??= []).push({ sign, width: r.width, height: r.height, frames: r.frames });
      fs.writeFileSync(OUT, JSON.stringify(held));
    }
  }
}
console.log(Object.entries(held).map(([k, v]) => `${k}: ${v.length} recordings`).join(", "), "->", OUT);
