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
  isKnownStatus,
  REFUSED_STATUSES,
  SUCCESS_STATUSES,
} from "../agent/lib/actions.ts";

// Every tool, plus the lib modules whose objects are spread into a tool's
// return. `send_outreach` returns `{...outcome}` straight out of
// agent/lib/resend.ts, so `dry_run` and `sent_to_test_inbox` reach the model
// from a file the first version of this test never opened.
//
// The rest of agent/lib is deliberately NOT scanned. A milestone, a roster
// row and a trace summary each carry their own `status` field — "upcoming",
// "drafted", "active" — and none of them is ever the top-level status of a
// tool result, which is the only thing actionOutcome reads. Scanning the
// whole directory reports them as unclassified and invites junk into the
// taxonomy. Add a file here when a tool starts returning its shape.
const DIRS = ["agent/tools", "agent/subagents/scout/tools"];
const FILES = ["agent/lib/resend.ts"];
const sources = [
  ...DIRS.flatMap((dir) =>
    readdirSync(new URL(`../${dir}`, import.meta.url))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `${dir}/${f}`),
  ),
  ...FILES,
];
const found = new Set();
const dynamic = [];
{
  for (const path of sources) {
    const src = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    // Digits belong in a status (`nudged_1`); excluding them skipped literals
    // silently, which is the exact failure this file exists to prevent.
    for (const m of src.matchAll(/status:\s*"([a-z0-9_]+)"/g)) found.add(m[1]);
    // A status assembled at runtime — `status: outcome` — cannot be read from
    // the source. The test cannot classify it, so it refuses to pass instead
    // of reporting a clean sweep it did not do.
    for (const m of src.matchAll(/status:\s*([A-Za-z_$][\w$]*)\s*[,}]/g)) {
      dynamic.push(`${path}: status: ${m[1]}`);
    }
  }
}

const known = new Set([...SUCCESS_STATUSES, ...REFUSED_STATUSES, ...FAILED_STATUSES]);
const unclassified = [...found].filter((s) => !isKnownStatus(s)).sort();

console.log(`${found.size} status literals across ${sources.length} sources`);
for (const s of [...found].sort()) {
  const outcome = actionOutcome({ result: { output: { status: s } } });
  const mark = isKnownStatus(s) ? "✓" : "✗";
  console.log(`  ${mark} ${s.padEnd(26)} -> ${outcome}`);
}

// The buckets must also behave, not merely exist.
const cases = [
  [{ status: "failed" }, "failed"],
  // eve's createActionResultEvent always attaches an error to a rejection.
  [{ status: "rejected", error: { code: "ACTION_RESULT_FAILED", message: "denied" } }, "refused"],
  [{ error: { message: "boom" } }, "failed"],
  [{ result: { isError: true } }, "failed"],
  [{ result: { output: { status: "ok" } } }, "success"],
  [{ result: { output: { status: "search_failed" } } }, "failed"],
  [{ result: { output: { status: "cap_reached" } } }, "refused"],
  [{ result: { output: { status: "blocked" } } }, "refused"],
  [{ result: { output: { status: "rejected_dead_source" } } }, "refused"],
  [{ result: { output: {} } }, "success"],
];
// Every case is the shape eve actually delivers, not a hand-built fixture.
// `{status:"rejected"}` alone passed while the real event — which always
// carries an `error` too — was being read as a failure.
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

// A runtime-assembled status is only acceptable once every value it can take
// is itself classified, which this file cannot prove by reading. Each one is
// listed here with its allowed values so the exemption is explicit.
const DYNAMIC_ALLOWED = {
  "agent/tools/complete_milestone.ts: status: outcome": ["done", "skipped"],
};
const unvetted = dynamic.filter((d) => !(d in DYNAMIC_ALLOWED));
for (const [site, values] of Object.entries(DYNAMIC_ALLOWED)) {
  for (const v of values) if (!isKnownStatus(v)) unvetted.push(`${site} -> "${v}" unclassified`);
}
if (unvetted.length) {
  bad += unvetted.length;
  console.log(`\nUNVETTED DYNAMIC STATUS:\n  ${unvetted.join("\n  ")}`);
  console.log("Add the site to DYNAMIC_ALLOWED with every value it can take.");
} else if (dynamic.length) {
  console.log(`\n${dynamic.length} runtime-assembled status site(s), all vetted`);
}
console.log(bad === 0 ? "\noutcome taxonomy: complete and correct" : `\n${bad} PROBLEM(S)`);
process.exit(bad === 0 ? 0 : 1);
