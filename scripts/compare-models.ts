/**
 * Which model should do this job? Measure, don't guess.
 *
 * The Nebius production-agent write-up makes model selection an experiment:
 * hold a labelled dataset constant, change one line of config, and compare.
 * This does that for the classifier role — the one job in Venus with ground
 * truth cheap enough to sweep — reporting accuracy, cost and latency per
 * candidate so the choice in agent/lib/models.ts is defensible rather than
 * a reputation contest.
 *
 *   npm run models:compare
 *   npm run models:compare -- deepseek-ai/DeepSeek-V4-Flash zai-org/GLM-5.3-Flash
 */
import { readFileSync } from "node:fs";
import { classifyReply } from "../agent/lib/classify.ts";
import { MODEL_ROLES } from "../agent/lib/models.ts";
import { costFor, formatUsd, priceFor } from "../agent/lib/pricing.ts";
import { type EvalCaseResult, saveEvalSummary, traceConfigured } from "../agent/lib/trace.ts";

interface Case {
  name: string;
  vendorName: string;
  originalSubject?: string;
  replyText: string;
  expected: string;
}

const cases = JSON.parse(
  readFileSync(new URL("../evals/data/vendor-replies.json", import.meta.url), "utf8"),
) as Case[];

/**
 * Candidates for a structured-output job on untrusted email: the incumbent,
 * the cheap long-context workhorses, and one small model to see how far down
 * the price curve accuracy survives.
 */
const DEFAULT_CANDIDATES = [
  "Qwen/Qwen3-235B-A22B-Instruct-2507",
  "deepseek-ai/DeepSeek-V4-Flash",
  "zai-org/GLM-5.3-Flash",
  "Qwen/Qwen3-30B-A3B-Instruct-2507",
  "nvidia/Nemotron-3_5-Lightning",
];

const candidates = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const models = candidates.length > 0 ? candidates : DEFAULT_CANDIDATES;

interface Row {
  model: string;
  passed: number;
  n: number;
  score: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  medianMs: number;
  fallbacks: number;
  cases: EvalCaseResult[];
  failed: string[];
}

const rows: Row[] = [];

for (const model of models) {
  if (!priceFor(model)) {
    console.log(`skip ${model} — not in the Token Factory price table`);
    continue;
  }
  console.log(`\n=== ${model}`);
  const caseResults: EvalCaseResult[] = [];
  const latencies: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let fallbacks = 0;
  const failed: string[] = [];

  for (const c of cases) {
    const t0 = Date.now();
    let intent = "error";
    let via = "heuristic";
    try {
      const out = await classifyReply({
        vendorName: c.vendorName,
        replyText: c.replyText,
        originalSubject: c.originalSubject,
        modelId: model,
      });
      intent = out.intel.intent;
      via = out.via;
      inputTokens += out.usage?.inputTokens ?? 0;
      outputTokens += out.usage?.outputTokens ?? 0;
    } catch (error) {
      intent = `error: ${String((error as Error)?.message ?? error).slice(0, 40)}`;
    }
    latencies.push(Date.now() - t0);
    // A heuristic fallback means the model failed to return the schema —
    // that is a failure of this candidate, not a free pass.
    if (via === "heuristic") fallbacks += 1;
    const ok = intent === c.expected && via === "model";
    if (!ok) failed.push(`${c.name}: ${intent}`);
    caseResults.push({
      name: c.name,
      expected: c.expected,
      got: intent,
      ok,
      note: via === "heuristic" ? "(schema not honoured — heuristic fallback)" : undefined,
    });
    process.stdout.write(ok ? "." : "x");
  }

  latencies.sort((a, b) => a - b);
  const passed = caseResults.filter((r) => r.ok).length;
  const costUsd = costFor(model, { inputTokens, outputTokens });
  rows.push({
    model,
    passed,
    n: cases.length,
    score: passed / cases.length,
    inputTokens,
    outputTokens,
    costUsd,
    medianMs: latencies[Math.floor(latencies.length / 2)] ?? 0,
    fallbacks,
    cases: caseResults,
    failed,
  });
  console.log(
    `\n  ${passed}/${cases.length} = ${((passed / cases.length) * 100).toFixed(0)}% · ` +
      `${formatUsd(costUsd)} for the set · median ${latencies[Math.floor(latencies.length / 2)]}ms` +
      (fallbacks ? ` · ${fallbacks} schema failures` : ""),
  );
}

rows.sort((a, b) => b.score - a.score || a.costUsd - b.costUsd);

console.log(`\n${"model".padEnd(40)}${"acc".padStart(6)}${"cost/set".padStart(11)}${"med ms".padStart(9)}${"  per 1k replies"}`);
for (const r of rows) {
  const per1k = (r.costUsd / cases.length) * 1000;
  console.log(
    r.model.padEnd(40) +
      `${(r.score * 100).toFixed(0)}%`.padStart(6) +
      formatUsd(r.costUsd).padStart(11) +
      String(r.medianMs).padStart(9) +
      `  ${formatUsd(per1k)}`,
  );
}

const incumbent = MODEL_ROLES.classifier.model;
const best = rows[0];
const cheapestPerfect = rows.filter((r) => r.score === 1).sort((a, b) => a.costUsd - b.costUsd)[0];
console.log(`\nincumbent: ${incumbent}`);
if (cheapestPerfect) {
  console.log(
    `cheapest at 100%: ${cheapestPerfect.model} (${formatUsd(cheapestPerfect.costUsd)} for the set)`,
  );
  if (cheapestPerfect.model !== incumbent) {
    const inc = rows.find((r) => r.model === incumbent);
    const saving = inc ? (1 - cheapestPerfect.costUsd / inc.costUsd) * 100 : 0;
    console.log(
      `→ set NEBIUS_CLASSIFIER_MODEL=${cheapestPerfect.model} for the same accuracy at ` +
        `${saving.toFixed(0)}% less cost.`,
    );
  } else {
    console.log("→ the incumbent is already the cheapest model at full accuracy. No change.");
  }
} else if (best) {
  console.log(`best: ${best.model} at ${(best.score * 100).toFixed(0)}% — nothing reached 100%.`);
}

if (traceConfigured() && rows.length > 0) {
  await saveEvalSummary({
    kind: "models",
    name: `Classifier model comparison (${rows.length} candidates, ${cases.length} labelled replies)`,
    ranAt: new Date().toISOString(),
    model: rows.map((r) => r.model).join(", "),
    judgeModel: null,
    n: rows.length,
    passed: rows.filter((r) => r.score === 1).length,
    score: best ? best.score : 0,
    cases: rows.map((r) => ({
      name: r.model,
      expected: "15/15",
      got: `${r.passed}/${r.n} · ${formatUsd(r.costUsd)} · ${r.medianMs}ms`,
      ok: r.score === 1,
      note: r.failed.slice(0, 2).join(" | ") || undefined,
    })),
    langsmith: null,
    note: `incumbent ${incumbent}${cheapestPerfect ? ` · cheapest at 100%: ${cheapestPerfect.model}` : ""}`,
  });
  console.log("\nsaved to KV → /observe");
}
