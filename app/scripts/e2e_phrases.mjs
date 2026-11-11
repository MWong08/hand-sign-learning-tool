// End-to-end check of PHRASE practice in a real browser (camera -> MediaPipe -> phrase tracker
// -> model -> feedback on screen), with Chrome's fake camera playing a phrase video made from
// the reference clips (real signing video), joined in two ways:
//   flow  each clip's active part straight after the previous one: no pause, no lowering
//   hold  each sign followed by a ~0.9 s hold (its last frame, with camera noise)
// Every video starts and ends with the hand out of view, and has camera noise throughout.
// With CUT_GAP=3, 3 blank frames (0.1 s) go between clips: at a hard cut the hand "teleports",
// and MediaPipe in the browser then often misses it for many frames, which a real signer never
// causes; a 0.1 s dropout (common on webcams anyway) lets it re-detect the hand. It is well under
// the 8 hand-less frames that count as lowering the hand. Videos
// are 640x480 (the size the app asks the camera for; the clips are padded at the sides, since a
// 360x480 file is stretched to 640x480 by the fake camera).
//
// The same videos can be played to any deployed version of the app (BASE), e.g. the live site
// before a change and the dev server after it.
// Needs: model/data/processed/reference_spans.json (model/src/reference_spans.py), ffmpeg in FFMPEG.
// Run from app/:  FFMPEG=... BASE=http://localhost:5173/ node scripts/e2e_phrases.mjs [flow,hold]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:5173/";
const STYLES = (process.argv[2] ?? "flow,hold").split(",");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HOLD_SECONDS = 0.9;
const CUT_GAP = Number(process.env.CUT_GAP ?? 0); // blank frames between clips (see above)
const vocab = JSON.parse(fs.readFileSync("public/vocabulary.json", "utf8"));
const spans = JSON.parse(fs.readFileSync("../model/data/processed/reference_spans.json", "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-phrase-"));

function phraseVideo(signs, style) {
  const out = path.join(tmp, `${signs.join("-")}-${style}.y4m`);
  const inputs = signs.flatMap((s) => ["-ss", String(spans[s][0]), "-to", String(spans[s][1]), "-i", `public/reference/${s}.mp4`]);
  const black = (label) => `color=black:s=640x480:d=2:r=30,setsar=1[${label}]`;
  const gap = (i) => (CUT_GAP && i < signs.length - 1 ? `,tpad=stop=${CUT_GAP * 2}:color=black` : ""); // 30 fps file
  const parts = signs.map((_, i) => `[${i}:v]scale=-2:480,pad=640:480:(ow-iw)/2:0,fps=30,setsar=1${style === "hold" ? `,tpad=stop_mode=clone:stop_duration=${HOLD_SECONDS}` : ""}${gap(i)}[v${i}]`);
  const graph = [black("a"), black("z"), ...parts,
    `[a]${signs.map((_, i) => `[v${i}]`).join("")}[z]concat=n=${signs.length + 2}:v=1,noise=alls=6:allf=t,format=yuv420p[out]`].join(";");
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[out]", out]);
  return out;
}

const results = [];
for (const style of STYLES) {
  for (const [i, phrase] of vocab.phrases.entries()) {
    const cam = phraseVideo(phrase.signs, style);
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${cam}`] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 900 });
    // open every phrase (Settings -> unlock all)
    await page.goto(`${BASE}#/settings`, { waitUntil: "load" });
    const box = await page.waitForSelector("input[type=checkbox]");
    if (!(await box.evaluate((b) => b.checked))) await box.click();
    await page.goto(`${BASE}#/phrase/${i}`, { waitUntil: "load" });
    // detection starts on Start (versions before 2026-11-12 had no Start button and detected at once)
    const startButton = await page.waitForSelector(".start-button", { timeout: 60000 }).catch(() => null);
    if (startButton) await startButton.click();
    // the video loops: wait for the result sheet, or give up after a few loops
    const done = await page.waitForSelector(".sheet", { timeout: 60000 }).then(() => true).catch(() => false);
    const chips = await page.$$eval(".phrase-chip", (els) => els.map((e) => ({
      verdict: ["correct", "close", "incorrect", "unclear"].find((v) => e.classList.contains(v)) ?? "none",
      joined: e.querySelector(".chip-joined")?.textContent ?? "",
    })));
    const flow = await page.$eval(".flow-summary", (e) => e.textContent).catch(() => "");
    results.push({ style, phrase: phrase.gloss, done, chips, flow });
    console.log(`${style.padEnd(5)} ${phrase.gloss.padEnd(24)} ${done ? "finished" : "NOT finished"} | ` +
      `${chips.map((c) => c.verdict + (c.joined ? ` (${c.joined})` : "")).join(", ")}${flow ? ` | ${flow}` : ""}`);
    await browser.close();
    fs.rmSync(cam);
  }
}
for (const style of STYLES) {
  const r = results.filter((x) => x.style === style);
  const signs = r.flatMap((x) => x.chips);
  console.log(`${style}: ${r.filter((x) => x.done).length}/${r.length} phrases finished, ` +
    `${signs.filter((c) => c.verdict === "correct").length}/${signs.length} signs correct, ` +
    `${signs.filter((c) => c.verdict === "close").length} close`);
}
fs.rmSync(tmp, { recursive: true, force: true });
