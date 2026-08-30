/**
 * Every status a tool can return must be classified.
 *
 * The outcome taxonomy lives in agent/lib/actions.ts as string sets, and the
 * tools invent their own literals. Nothing links the two, so renaming a
 * status compiles cleanly and silently zeroes a metric — which is how
 * `blocked`, `not_found`, `cap_reached` and `unavailable` were all being
 * counted as healthy successes.
 *
 * This reads the literals back out of the tool sources and fails on any the
 * taxonomy does not know about.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/test-outcomes.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import {
  actionOutcome,
  FAILED_STATUSES,
  REFUSED_STATUSES,
  SUCCESS_STATUSES,
} from "../agent/lib/actions.ts";

const DIRS = ["agent/tools", "agent/subagents/scout/tools"];
const found = new Set();
for (const dir of DIRS) {
  for (const file of readdirSync(new URL(`../${dir}`, import.meta.url))) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(new URL(`../${dir}/${file}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/status:\s*"([a-z_]+)"/g)) found.add(m[1]);
  }
}

const known = new Set([...SUCCESS_STATUSES, ...REFUSED_STATUSES, ...FAILED_STATUSES]);
const unclassified = [...found].filter((s) => !known.has(s) && !s.startsWith("rejected_")).sort();

console.log(`${found.size} status literals across the tools`);
for (const s of [...found].sort()) {
  const outcome = actionOutcome({ result: { output: { status: s } } });
  const mark = known.has(s) || s.startsWith("rejected_") ? "✓" : "✗";
  console.log(`  ${mark} ${s.padEnd(26)} -> ${outcome}`);
}

// The buckets must also behave, not merely exist.
const cases = [
  [{ status: "failed" }, "failed"],
  [{ status: "rejected" }, "refused"],
  [{ error: { message: "boom" } }, "failed"],
  [{ result: { isError: true } }, "failed"],
  [{ result: { output: { status: "ok" } } }, "success"],
  [{ result: { output: { status: "search_failed" } } }, "failed"],
  [{ result: { output: { status: "cap_reached" } } }, "refused"],
  [{ result: { output: { status: "blocked" } } }, "refused"],
  [{ result: { output: { status: "rejected_dead_source" } } }, "refused"],
  [{ result: { output: {} } }, "success"],
];
let bad = unclassified.length;
console.log("");
for (const [data, want] of cases) {
  const got = actionOutcome(data);
  const ok = got === want;
  if (!ok) bad += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${JSON.stringify(data).slice(0, 52).padEnd(54)} -> ${got}`);
}

if (unclassified.length) {
  console.log(`\nUNCLASSIFIED: ${unclassified.join(", ")}`);
  console.log("Add each to SUCCESS_STATUSES, REFUSED_STATUSES or FAILED_STATUSES.");
}
console.log(bad === 0 ? "\noutcome taxonomy: complete and correct" : `\n${bad} PROBLEM(S)`);
process.exit(bad === 0 ? 0 : 1);
