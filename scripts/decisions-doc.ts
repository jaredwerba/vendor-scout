/**
 * Renders docs/engineering-log.md from evals/data/decisions.json.
 *
 * Generated rather than hand-written so the log cannot drift from the record
 * the console reads. One entry per change that mattered: what was wrong, why
 * it was wrong, what changed, what happened, and what it cost to learn.
 *
 *   npm run docs:log
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Decision {
  date: string;
  title: string;
  symptom: string;
  cause: string;
  change: string;
  outcome: string;
  lesson: string;
  evidence?: { commits?: string[]; runs?: string[]; tests?: string[] };
}

const decisions = JSON.parse(
  readFileSync(new URL("../evals/data/decisions.json", import.meta.url), "utf8"),
) as Decision[];

const byDate = new Map<string, Decision[]>();
for (const d of decisions) {
  byDate.set(d.date, [...(byDate.get(d.date) ?? []), d]);
}

const out: string[] = [];
out.push("# Engineering log");
out.push("");
out.push(
  "Every change that mattered, dated: what was wrong, why it was wrong, what changed, and what",
  "happened as a result. Generated from `evals/data/decisions.json` — the same record the",
  "console reads — so it cannot drift from the evidence.",
);
out.push("");
out.push(
  "The pattern worth noticing before reading it: **not one of these announced itself.** No",
  "crashes, no stack traces, no red builds. Costs that were always zero. An event the",
  "documentation promises and the runtime never sends. A page section present in development",
  "and absent in production. A dashboard reporting a model that had been reverted hours",
  "earlier. Ten of ten sub-agents dying inside a passing build.",
);
out.push("");
out.push("The failures that cost the most are the ones that look like success.");
out.push("");

for (const [date, items] of [...byDate.entries()].sort()) {
  out.push(`## ${date}`);
  out.push("");
  for (const d of items) {
    out.push(`### ${d.title}`);
    out.push("");
    out.push(`**Wrong.** ${d.symptom}`);
    out.push("");
    out.push(`**Why.** ${d.cause}`);
    out.push("");
    out.push(`**Changed.** ${d.change}`);
    out.push("");
    out.push(`**Outcome.** ${d.outcome}`);
    out.push("");
    out.push(`> ${d.lesson}`);
    const ev = d.evidence ?? {};
    const bits: string[] = [];
    if (ev.commits?.length) bits.push(`commits ${ev.commits.map((c) => `\`${c}\``).join(", ")}`);
    if (ev.runs?.length) bits.push(`runs ${ev.runs.map((r) => `\`${r}\``).join(", ")}`);
    if (ev.tests?.length) bits.push(`tests ${ev.tests.map((t) => `\`${t}\``).join(", ")}`);
    if (bits.length) {
      out.push("");
      out.push(`<sub>${bits.join(" · ")}</sub>`);
    }
    out.push("");
  }
}

out.push("---");
out.push("");
out.push("## How to read the outcomes");
out.push("");
out.push(
  "Scores are from `npm run eval:scout`, which drives a fixed brief against the live",
  "deployment, waits for the specialist fan-out to settle, then grades what was recorded:",
  "coverage, distinct vendors, a working contact path, sources on the vendor's own site,",
  "addresses that belong to the vendor, a stated town, live URLs, venue photos, and two",
  "judge questions — is this a real business, and is it inside the couple's radius.",
);
out.push("");
out.push("| Run | Score | What changed since the previous run |");
out.push("|---|---|---|");
out.push("| first clean measurement | 29/33 (88%) | — |");
out.push("| with the tool-level guards | 46/50 (92%) | directory sources and vendor-mismatched emails refused |");
out.push("| cheaper specialist model | **10/22 (45%)** | 10 of 10 sub-agent sessions failed |");
out.push("| reverted, schema deleted | 33/37 (89%) | sessions healthy, volume suppressed by my own guardrail |");
out.push("| drive-time fix | **52/53 (98%)** | radius judged from town knowledge instead of searched for |");
out.push("");
out.push(
  "The 45% row is kept deliberately. It is the generation most write-ups omit, and it is the",
  "one that proves the cheap-model swap is only safe over a harness that survives it.",
);
out.push("");

writeFileSync(new URL("../docs/engineering-log.md", import.meta.url), `${out.join("\n")}\n`);
console.log(`docs/engineering-log.md — ${decisions.length} decisions across ${byDate.size} days`);
