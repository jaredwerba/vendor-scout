/**
 * Validate every cookbook recipe against schema/recipe.schema.json.
 *
 * Hand-rolled rather than pulling in a JSON-Schema library, because the only
 * thing that needs checking is the subset this cookbook actually uses, and a
 * validator nobody runs because it needs an install is worse than none.
 *
 *   node scripts/validate-cookbook.mjs
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const COOKBOOK = join(ROOT, "cookbook");
const schema = JSON.parse(readFileSync(join(COOKBOOK, "schema", "recipe.schema.json"), "utf8"));

const MIN = /^[0-9]+ ?min$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DIFFICULTY = new Set(["beginner", "intermediate", "advanced"]);

let failures = 0;
const problem = (dir, msg) => {
  failures += 1;
  console.error(`✗ ${dir}: ${msg}`);
};

const dirs = readdirSync(COOKBOOK, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
  .map((d) => d.name)
  .sort();

if (dirs.length === 0) {
  console.error("✗ no recipes found under cookbook/");
  process.exit(1);
}

const slugs = new Set();
for (const dir of dirs) {
  const file = join(COOKBOOK, dir, "recipe.json");
  if (!existsSync(file)) {
    problem(dir, "recipe.json is missing");
    continue;
  }
  if (!existsSync(join(COOKBOOK, dir, "README.md"))) problem(dir, "README.md is missing");

  let r;
  try {
    r = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problem(dir, `recipe.json does not parse — ${error.message}`);
    continue;
  }

  for (const key of schema.required) {
    if (r[key] === undefined) problem(dir, `missing required field \`${key}\``);
  }

  if (r.slug !== dir.slice(3)) problem(dir, `slug "${r.slug}" does not match the directory`);
  if (!SLUG.test(r.slug ?? "")) problem(dir, `slug "${r.slug}" is not kebab-case`);
  if (r.order !== Number(dir.slice(0, 2))) problem(dir, `order ${r.order} does not match the prefix`);
  if (!DIFFICULTY.has(r.difficulty)) problem(dir, `difficulty "${r.difficulty}" is not valid`);
  if (!MIN.test(r.estimatedReadingTime ?? "")) problem(dir, `estimatedReadingTime "${r.estimatedReadingTime}" must match "N min"`);
  if (!MIN.test(r.estimatedRunTime ?? "")) problem(dir, `estimatedRunTime "${r.estimatedRunTime}" must match "N min"`);
  if ((r.eyebrow ?? "").length > 24) problem(dir, `eyebrow "${r.eyebrow}" exceeds 24 characters`);
  if ((r.tagline ?? "").length > 160) problem(dir, "tagline exceeds 160 characters");
  if (!Array.isArray(r.stack?.primary) || r.stack.primary.length === 0) problem(dir, "stack.primary must be a non-empty array");
  if (!Array.isArray(r.tags) || r.tags.length === 0) problem(dir, "tags must be a non-empty array");
  if (!Array.isArray(r.models) || r.models.length === 0) problem(dir, "models must be a non-empty array");
  for (const m of r.models ?? []) {
    if (!m?.id || !m?.role) problem(dir, `a models[] entry is missing id or role`);
  }
  for (const k of ["problem", "solution", "outcome"]) {
    if (!r.story?.[k]) problem(dir, `story.${k} is missing`);
  }
  for (const k of ["clone", "configure", "run"]) {
    if (!r.quickstart?.[k]) problem(dir, `quickstart.${k} is missing`);
  }
  if (slugs.has(r.slug)) problem(dir, `duplicate slug "${r.slug}"`);
  slugs.add(r.slug);
}

// nextRecipe must point at a slug that exists — a dangling link is the kind of
// quiet drift the catalog generator exists to prevent.
for (const dir of dirs) {
  const file = join(COOKBOOK, dir, "recipe.json");
  if (!existsSync(file)) continue;
  const r = JSON.parse(readFileSync(file, "utf8"));
  if (r.nextRecipe && !slugs.has(r.nextRecipe)) {
    problem(dir, `nextRecipe "${r.nextRecipe}" does not match any recipe`);
  }
}

if (failures) {
  console.error(`\n${failures} problem(s) across ${dirs.length} recipes`);
  process.exit(1);
}
console.log(`✓ ${dirs.length} recipes valid against schema/recipe.schema.json`);
