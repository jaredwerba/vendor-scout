/**
 * Render pages of the app to PNGs, so the front end can be looked at instead
 * of reasoned about. Drives the Chrome already installed on the machine.
 *
 * The layout claim this project makes — everything visible while the agent
 * runs, at every width — is only checkable by looking, and every gate in this
 * repo (typecheck, build, evals) passes happily on a panel that renders off
 * the bottom of the screen.
 *
 *   npm i -D playwright        # once
 *   npm run dev                # or point it at production
 *   node scripts/shot.mjs [baseUrl] [outDir]
 */
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "This needs Playwright, which is not a dependency of the app:\n  npm i -D playwright\n" +
      "It drives the Chrome already on the machine — no browser download.",
  );
  process.exit(1);
}

const base = process.argv[2] ?? "https://vendor-scout-xi.vercel.app";
const out = process.argv[3] ?? "/private/tmp/claude-501/-Users-jkw/52c03e4b-28af-4bed-bfe3-defe9c0039bc/scratchpad/shots";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1180, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];
const PAGES = [
  { name: "landing", path: "/" },
  { name: "observe", path: "/observe" },
];

const browser = await chromium.launch({ channel: "chrome" });
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  for (const p of PAGES) {
    try {
      await page.goto(base + p.path, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(1200);
      const file = `${out}/${p.name}-${vp.name}.png`;
      await page.screenshot({ path: file, fullPage: p.name === "observe" });
      console.log(`${file}`);
    } catch (e) {
      console.log(`FAILED ${p.name}@${vp.name}: ${String(e.message).slice(0, 100)}`);
    }
  }
  await ctx.close();
}
await browser.close();
