/**
 * Is public/venus-architecture.html still what docs/venus.architecture.json says?
 *
 * The map is generated from the IR by an external renderer (see
 * docs/architecture-diagram.md), so nothing in this repo's own gates would
 * notice the IR being edited and the artifact not being re-delivered — the
 * live page is linked from every nav and declared as blueprint.json's
 * assets.architecture, so it would go stale in public and silently.
 *
 * cookbook:check exists for exactly this shape of problem. This is its
 * sibling: the IR hash is recorded at delivery time and asserted here.
 * Re-deliver, then refresh the hash, in the same commit.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/check-architecture-drift.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const IR = "docs/venus.architecture.json";
const STAMP = "docs/venus.architecture.sha256";
const OUT = "public/venus-architecture.html";
const fail = (m) => { console.error(`architecture map: ${m}`); process.exit(1); };

for (const f of [IR, STAMP, OUT]) if (!existsSync(f)) fail(`${f} is missing`);

const actual = createHash("sha256").update(readFileSync(IR)).digest("hex");
const recorded = readFileSync(STAMP, "utf8").trim();
if (actual !== recorded) {
  fail(
    `${IR} changed since ${OUT} was delivered.\n` +
      `  recorded ${recorded.slice(0, 16)}\n  actual   ${actual.slice(0, 16)}\n` +
      "  Re-deliver and refresh the stamp — see docs/architecture-diagram.md.",
  );
}

// A hash proves the IR is unchanged; it cannot prove the HTML came from it.
// Spot-check that what the IR asserts is actually in the artifact.
const ir = JSON.parse(readFileSync(IR, "utf8"));
const html = readFileSync(OUT, "utf8");
const missing = [
  ir.meta.title,
  ...ir.meta.views.map((v) => v.label),
  ...ir.components.map((c) => c.label),
].filter((s) => !html.includes(s));
if (missing.length) fail(`${OUT} does not carry: ${missing.slice(0, 4).join(" | ")}`);

console.log(`✓ architecture map is current (${ir.components.length} components, ${ir.meta.views.length} chapters)`);
