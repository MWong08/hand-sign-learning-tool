// End-to-end check of the camera framing check and UAT mode in a real browser, with Chrome's
// fake camera playing prepared videos instead of a webcam.
//   1. Framing: a well-framed signer, a dark picture, and a signer shrunk to look far away
//      should show "Good set-up", "too dark" and "too far" respectively.
//   2. UAT: start a session for P07, practise a sign, end the session, and check the
//      downloaded CSV holds the session start, the screens visited, the attempt and the end.
// Needs the dev server running (npm run dev) and an ffmpeg executable path in FFMPEG.
//
// Run from app/:  FFMPEG=... node scripts/e2e_uat.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://localhost:5173/";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-uat-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// sign clip, looped; filter decides how the person is framed. gap: add 1.5 s of empty frame
// (the hand "lowered"), needed to complete an attempt but it also looks like nobody is there.
function camera(name, filter, gap = false) {
  const out = path.join(tmp, `${name}.y4m`);
  if (!gap) {
    execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-stream_loop", "3", "-i", "public/reference/hello.mp4",
      "-vf", `scale=360:480,fps=30,setsar=1,${filter}`, "-pix_fmt", "yuv420p", out]);
    return out;
  }
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-stream_loop", "3", "-i", "public/reference/hello.mp4",
    "-f", "lavfi", "-i", "color=black:s=360x480:d=1.5:r=30", "-filter_complex",
    `[0:v]scale=360:480,fps=30,setsar=1,${filter}[a];[1:v]setsar=1[b];[a][b]concat=n=2:v=1[v]`,
    "-map", "[v]", "-pix_fmt", "yuv420p", out]);
  return out;
}

async function open(cam, route) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${cam}`] });
  const page = await browser.newPage();
  await page.goto(APP + route, { waitUntil: "load" });
  return { browser, page };
}

// collect every framing message shown over ~12 s
async function framingMessages(page) {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const t = await page.$eval(".framing-tip, .framing-ok", (e) => e.textContent).catch(() => null);
    if (t) seen.add(t);
  }
  return [...seen];
}

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

// ---- 1. framing ----
const cases = [
  { name: "good", filter: "null", expect: (m) => m.length === 1 && m[0].includes("Good set-up") },
  { name: "dark", filter: "eq=brightness=-0.6", expect: (m) => m.some((t) => /too dark/.test(t)) },
  // shrink the signer to 30% and pad back to full size: looks far away
  { name: "far", filter: "scale=108:144,pad=360:480:126:168:gray", expect: (m) => m.some((t) => /too far/.test(t)) },
];
for (const c of cases) {
  const { browser, page } = await open(camera(c.name, c.filter), "#/practice/0/0");
  const msgs = await framingMessages(page);
  check(c.expect(msgs), `framing, ${c.name} camera: ${JSON.stringify(msgs)}`);
  await browser.close();
}

// ---- 2. UAT session ----
{
  const { browser, page } = await open(camera("uat", "null", true), "#/settings");
  const downloads = path.join(tmp, "downloads");
  fs.mkdirSync(downloads);
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });

  await page.waitForSelector(".uat-start input");
  await page.type(".uat-start input", "Alice");
  await page.click(".uat-start .button");
  check(await page.$eval(".error", (e) => e.textContent.includes("participant code")).catch(() => false), "UAT refuses a name as participant code");

  await page.$eval(".uat-start input", (e) => { e.value = ""; });
  await page.type(".uat-start input", "p07");
  await page.click(".uat-start .button");
  await page.waitForSelector(".uat-banner");
  check((await page.$eval(".uat-banner", (e) => e.textContent)).includes("P07"), "UAT banner shows participant P07");

  await page.goto(APP + "#/unit/0");
  await sleep(500);
  await page.goto(APP + "#/practice/0/0"); // hello
  await (await page.waitForSelector(".start-button", { timeout: 60000 })).click(); // detection starts on Start
  let judged = false;
  for (let i = 0; i < 100 && !judged; i++) {
    await sleep(400);
    const cls = await page.$eval(".sheet", (e) => e.className).catch(() => "");
    judged = /correct|close|incorrect/.test(cls);
  }
  check(judged, "an attempt was judged during the session");
  await sleep(1000); // let the attempt save

  await page.goto(APP + "#/settings");
  await page.waitForSelector(".uat-panel .button.primary");
  await page.click(".uat-panel .button.primary"); // End session and download data
  let file = null;
  for (let i = 0; i < 30 && !file; i++) {
    await sleep(300);
    file = fs.readdirSync(downloads).find((f) => /^uat-P07-\d{8}\.csv$/.test(f));
  }
  check(Boolean(file), `session CSV downloaded (${file})`);
  if (file) {
    const rows = fs.readFileSync(path.join(downloads, file), "utf8").split("\n").map((l) => l.split(","));
    const events = rows.slice(1).map((r) => r[4]);
    const pages = rows.slice(1).filter((r) => r[4] === "page").map((r) => r[5]);
    console.log("      events:", events.join(" "), "| pages:", pages.join(" "));
    check(events[0] === "session-start" && events.at(-1) === "session-end", "CSV starts and ends the session");
    check(pages.includes("unit/0") && pages.includes("practice/0/0"), "CSV logs the screens visited");
    const attempt = rows.find((r) => r[4] === "attempt");
    check(attempt && attempt[0] === "P07" && attempt[7] === "hello", `CSV holds the attempt: ${attempt?.join(",")}`);
  }
  check(!(await page.$(".uat-banner")), "banner gone after the session ends");
  await browser.close();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
