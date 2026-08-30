/**
 * Regenerate the recipes table in cookbook/README.md from the recipe.json files.
 *
 * Modelled on `bun run build:readme` in the Nebius cookbook, and for the same
 * reason: a hand-maintained catalog drifts from the recipes it lists, and a
 * table that disagrees with its own source is the kind of quiet fault this
 * cookbook is about. `--check` fails when the tree has drifted, so CI catches
 * it instead of a reader.
 *
 *   node scripts/build-cookbook-readme.mjs
 *   node scripts/build-cookbook-readme.mjs --check
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const COOKBOOK = join(ROOT, "cookbook");
const README = join(COOKBOOK, "README.md");
const BEGIN = "<!-- BEGIN:RECIPES -->";
const END = "<!-- END:RECIPES -->";

const dirs = readdirSync(COOKBOOK, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
  .map((d) => d.name)
  .sort();

const recipes = [];
for (const dir of dirs) {
  const file = join(COOKBOOK, dir, "recipe.json");
  if (!existsSync(file)) {
    console.error(`✗ ${dir}/recipe.json is missing`);
    process.exitCode = 1;
    continue;
  }
  const r = JSON.parse(readFileSync(file, "utf8"));
  const prefix = Number(dir.slice(0, 2));
  if (r.order !== prefix) {
    console.error(`✗ ${dir}: recipe.json order ${r.order} does not match the directory prefix`);
    process.exitCode = 1;
  }
  if (r.slug !== dir.slice(3)) {
    console.error(`✗ ${dir}: recipe.json slug "${r.slug}" does not match the directory`);
    process.exitCode = 1;
  }
  recipes.push({ dir, ...r });
}

const stack = (r) => [...(r.stack?.primary ?? []), ...(r.stack?.secondary ?? [])]
  .map((s) => `\`${s}\``)
  .join(" ");

const rows = recipes.map(
  (r) =>
    `| ${String(r.order).padStart(2, "0")} | [${r.eyebrow} — ${r.title}](./${r.dir}/) | ${stack(r)} | ${r.difficulty} | ${r.estimatedReadingTime} |`,
);

const table = [
  "| # | Recipe | Stack | Difficulty | Reading |",
  "| --- | --- | --- | --- | --- |",
  ...rows,
].join("\n");

const current = readFileSync(README, "utf8");
const start = current.indexOf(BEGIN);
const stop = current.indexOf(END);
if (start === -1 || stop === -1) {
  console.error(`✗ ${README} is missing the ${BEGIN} / ${END} markers`);
  process.exit(1);
}
const next =
  current.slice(0, start + BEGIN.length) + "\n\n" + table + "\n\n" + current.slice(stop);

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error("✗ cookbook/README.md is out of date — run: node scripts/build-cookbook-readme.mjs");
    process.exit(1);
  }
  console.log(`✓ cookbook/README.md is current (${recipes.length} recipes)`);
} else {
  writeFileSync(README, next);
  console.log(`✓ cookbook/README.md regenerated (${recipes.length} recipes)`);
}
