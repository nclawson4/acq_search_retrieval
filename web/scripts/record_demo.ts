/* Record a short Chromium video of the live homepage at desktop dimensions
 * and convert it to docs/demo.gif. Reproducible: re-run after a deploy to
 * refresh the demo asset.
 *
 * Usage from web/:  npx tsx scripts/record_demo.ts
 */
import { chromium } from "playwright";
import { mkdir, rm, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(WEB_DIR, "..");
const OUT_DIR = resolve(REPO_ROOT, "docs");
const VIDEO_DIR = resolve(HERE, "_demo_video");
const FINAL_GIF = resolve(OUT_DIR, "demo.gif");

const URL = "https://acq-search-v1.vercel.app/";
const VIEWPORT = { width: 1440, height: 900 };
// Playwright records from context creation, so the first few seconds are
// blank/loading. We capture a longer window then ffmpeg-trim the head.
const SETTLE_MS = 4500; // wait after networkidle for fonts + first chip reveal
const RECORD_MS = 14000; // ~2 full animation cycles after settle
const TRIM_HEAD_S = 4.5; // seconds to drop from the front of the webm

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("exit", (code) =>
      code === 0 ? resolveP() : rejectP(new Error(`${cmd} exit ${code}`)),
    );
    p.on("error", rejectP);
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await rm(VIDEO_DIR, { recursive: true, force: true });
  await mkdir(VIDEO_DIR, { recursive: true });

  console.log("Launching Chromium...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
  });
  const page = await context.newPage();

  console.log(`Navigating to ${URL}...`);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  console.log(`Settling for ${SETTLE_MS}ms (fonts + first reveal)...`);
  await page.waitForTimeout(SETTLE_MS);

  console.log(`Recording ${RECORD_MS}ms...`);
  await page.waitForTimeout(RECORD_MS);

  await context.close();
  await browser.close();

  // Locate the webm playwright wrote
  const files = await readdir(VIDEO_DIR);
  const webm = files.find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("No webm produced");
  const webmPath = resolve(VIDEO_DIR, webm);
  console.log(`Captured: ${webmPath}`);

  // Two-pass gif with palette for clean colors at smaller size.
  const paletteFile = resolve(VIDEO_DIR, "palette.png");
  const fps = 15;
  // Scale width to 1100 (preserve AR) — keeps GIF under ~6MB for README.
  const filters = `fps=${fps},scale=1100:-1:flags=lanczos`;

  console.log("Generating palette...");
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(TRIM_HEAD_S),
    "-i",
    webmPath,
    "-vf",
    `${filters},palettegen=stats_mode=diff`,
    paletteFile,
  ]);

  console.log("Encoding GIF...");
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(TRIM_HEAD_S),
    "-i",
    webmPath,
    "-i",
    paletteFile,
    "-lavfi",
    `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    FINAL_GIF,
  ]);

  console.log(`Wrote ${FINAL_GIF}`);
  // Clean working dir but keep the gif
  await rm(VIDEO_DIR, { recursive: true, force: true });
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
