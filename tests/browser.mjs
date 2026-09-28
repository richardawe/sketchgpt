// One place to launch Chromium for the browser checks.
//
// Playwright normally manages its own browser download, but a sandbox often
// already has one at a path that does not match the installed Playwright's
// expected revision — which fails with "run npx playwright install" even
// though a perfectly good Chromium is sitting on disk. SKETCH_CHROME points at
// it instead.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
//   SKETCH_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
//   node tests/stop.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

export async function launch() {
  const exe = process.env.SKETCH_CHROME;
  return chromium.launch({
    headless: true,
    ...(exe ? { executablePath: exe, args: ["--no-sandbox"] } : {})
  });
}
