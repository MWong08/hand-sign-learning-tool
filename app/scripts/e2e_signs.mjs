// End-to-end check of the LIVE browser pipeline (camera -> MediaPipe -> attempt recorder ->
// preprocessing -> TF.js model -> feedback on screen), with Chrome's fake camera playing each
// sign's reference clip (+1.5 s of "hand lowered") instead of a webcam.
// Needs the dev server running (npm run dev) and an ffmpeg executable path in FFMPEG.
//
// Note: the reference clips are VALIDATION clips chosen for clarity, so this is a best-case
// integration check of the pipeline, not an accuracy estimate (see the test-set results).
//
// Run from app/:  FFMPEG=... node scripts/e2e_signs.mjs [attemptsPerSign]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const ATTEMPTS = Number(process.argv[2] ?? 2);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
const vocab = JSON.parse(fs.readFileSync("public/vocabulary.json", "utf8"));
const signs = vocab.units.flatMap((u, i) => u.signs.map((s, j) => ({ id: s.id, route: `${i}/${j}` })));

function fakeCamera(signId) {
  const out = path.join(tmp, `${signId}.y4m`);
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-i", `public/reference/${signId}.mp4`,
    "-f", "lavfi", "-i", "color=black:s=360x480:d=1.5:r=30", "-filter_complex",
    "[0:v]scale=360:480,fps=30,setsar=1[a];[1:v]setsar=1[b];[a][b]concat=n=2:v=1[v]",
    "-map", "[v]", "-pix_fmt", "yuv420p", out]);
  return out;
}

const tally = { correct: 0, close: 0, incorrect: 0, unclear: 0, missing: 0 };
const misses = [];
for (const sign of signs) {
  const cam = fakeCamera(sign.id);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${cam}`] });
  const page = await browser.newPage();
  await page.goto(`http://localhost:5173/#/practice/${sign.route}`, { waitUntil: "load" });
  await (await page.waitForSelector(".start-button", { timeout: 60000 })).click(); // detection starts on Start
  const got = [];
  let lastAttempt = "0";
  const deadline = Date.now() + 75000;
  while (got.length < ATTEMPTS && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    // each new result sheet carries the next attempt number
    const fb = await page.$eval(".sheet", (e) => [e.className, (e.innerText.match(/looked more like “([^”]+)”/) || [])[1] || "",
      e.dataset.attempt]).catch(() => null);
    if (fb && fb[2] !== lastAttempt) {
      lastAttempt = fb[2];
      got.push({ verdict: fb[0].replace("sheet", "").trim(), lookedLike: fb[1] });
    }
  }
  for (let k = got.length; k < ATTEMPTS; k++) got.push({ verdict: "missing" });
  got.forEach((g) => { tally[g.verdict in tally ? g.verdict : "unclear"]++; if (g.verdict !== "correct") misses.push(`${sign.id}: ${g.verdict}${g.lookedLike ? ` (looked like ${g.lookedLike})` : ""}`); });
  await browser.close();
  fs.rmSync(cam);
  process.stdout.write(".");
}
const n = signs.length * ATTEMPTS;
console.log(`\n${signs.length} signs x ${ATTEMPTS} attempts = ${n}:`, tally);
console.log(`top-1 correct ${(tally.correct / n * 100).toFixed(1)}%, correct or close ${((tally.correct + tally.close) / n * 100).toFixed(1)}%`);
if (misses.length) console.log("not correct:\n  " + misses.join("\n  "));
fs.rmSync(tmp, { recursive: true, force: true });
