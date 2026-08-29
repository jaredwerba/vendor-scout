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
/**
 * One pass over fifteen cases cannot separate two models near the top — it
 * can only rule out the clearly worse. Learned the hard way: DeepSeek-V4-Flash
 * won a single-pass sweep at 15/15 and scored 11/15 with six schema failures
 * on the very next run of the same cases.
 */
const ROUNDS = Number(process.env.COMPARE_ROUNDS ?? 3);

interface Row {
  model: string;
  passed: number;
  n: number;
  score: number;
  /** Worst single round — what this model does on a bad day. */
  worstScore: number;
  rounds: number[];
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
  const roundScores: number[] = [];

  for (let round = 0; round < ROUNDS; round += 1) {
  let roundPassed = 0;
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
    if (ok) roundPassed += 1;
    else failed.push(`r${round + 1} ${c.name}: ${intent}`);
    caseResults.push({
      name: ROUNDS > 1 ? `${c.name} (r${round + 1})` : c.name,
      expected: c.expected,
      got: intent,
      ok,
      note: via === "heuristic" ? "(schema not honoured — heuristic fallback)" : undefined,
    });
    process.stdout.write(ok ? "." : "x");
  }
  roundScores.push(roundPassed / cases.length);
  process.stdout.write(` r${round + 1}=${roundPassed}/${cases.length}\n  `);
  }

  latencies.sort((a, b) => a - b);
  const passed = caseResults.filter((r) => r.ok).length;
  const costUsd = costFor(model, { inputTokens, outputTokens });
  rows.push({
    model,
    passed,
    n: cases.length * ROUNDS,
    score: passed / (cases.length * ROUNDS),
    worstScore: Math.min(...roundScores),
    rounds: roundScores,
    inputTokens,
    outputTokens,
    costUsd,
    medianMs: latencies[Math.floor(latencies.length / 2)] ?? 0,
    fallbacks,
    cases: caseResults,
    failed,
  });
  console.log(
    `\n  ${passed}/${cases.length * ROUNDS} = ${((passed / (cases.length * ROUNDS)) * 100).toFixed(0)}% ` +
      `across ${ROUNDS} rounds (worst ${(Math.min(...roundScores) * 100).toFixed(0)}%) · ` +
      `${formatUsd(costUsd)} · median ${latencies[Math.floor(latencies.length / 2)]}ms` +
      (fallbacks ? ` · ${fallbacks} schema failures` : ""),
  );
}

rows.sort((a, b) => b.worstScore - a.worstScore || b.score - a.score || a.costUsd - b.costUsd);

console.log(
  `\n${"model".padEnd(40)}${"mean".padStart(6)}${"worst".padStart(7)}${"med ms".padStart(9)}${"  per 1k replies"}`,
);
for (const r of rows) {
  const per1k = (r.costUsd / (cases.length * ROUNDS)) * 1000;
  console.log(
    r.model.padEnd(40) +
      `${(r.score * 100).toFixed(0)}%`.padStart(6) +
      `${(r.worstScore * 100).toFixed(0)}%`.padStart(7) +
      String(r.medianMs).padStart(9) +
      `  ${formatUsd(per1k)}`,
  );
}

const incumbent = MODEL_ROLES.classifier.model;
const best = rows[0];
// A candidate has to be perfect in EVERY round to be considered — one bad
// round out of three is exactly the signal a single pass would have hidden.
const cheapestPerfect = rows.filter((r) => r.worstScore === 1).sort((a, b) => a.costUsd - b.costUsd)[0];
console.log(`\nincumbent: ${incumbent}`);
if (cheapestPerfect) {
  console.log(
    `cheapest at 100%: ${cheapestPerfect.model} (${formatUsd(cheapestPerfect.costUsd)} for the set)`,
  );
  if (cheapestPerfect.model !== incumbent) {
    const inc = rows.find((r) => r.model === incumbent);
    const saving = inc ? (1 - cheapestPerfect.costUsd / inc.costUsd) * 100 : 0;
    console.log(
      `→ ${cheapestPerfect.model} held 100% across all ${ROUNDS} rounds at ${saving.toFixed(0)}% ` +
        "less cost. Re-run this sweep once more before switching; a model that wins one sweep " +
        "and fails the next is the failure mode this harness exists to catch.",
    );
  } else {
    console.log("→ the incumbent is already the cheapest model at full accuracy. No change.");
  }
} else if (best) {
  console.log(
    `best: ${best.model} at ${(best.score * 100).toFixed(0)}% mean / ` +
      `${(best.worstScore * 100).toFixed(0)}% worst — nothing held 100% across every round.`,
  );
}

if (traceConfigured() && rows.length > 0) {
  await saveEvalSummary({
    kind: "models",
    name: `Classifier model comparison (${rows.length} candidates × ${ROUNDS} rounds × ${cases.length} labelled replies)`,
    ranAt: new Date().toISOString(),
    model: rows.map((r) => r.model).join(", "),
    judgeModel: null,
    n: rows.length,
    passed: rows.filter((r) => r.worstScore === 1).length,
    score: best ? best.score : 0,
    cases: rows.map((r) => ({
      name: r.model,
      expected: "15/15",
      got: `${r.passed}/${r.n} · worst round ${(r.worstScore * 100).toFixed(0)}% · ${formatUsd(r.costUsd)} · ${r.medianMs}ms`,
      ok: r.worstScore === 1,
      note: r.failed.slice(0, 2).join(" | ") || undefined,
    })),
    langsmith: null,
    note: `incumbent ${incumbent}${cheapestPerfect ? ` · cheapest at 100%: ${cheapestPerfect.model}` : ""}`,
  });
  console.log("\nsaved to KV → /observe");
}
