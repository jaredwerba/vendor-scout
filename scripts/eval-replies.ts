/**
 * Visible eval: how well does Venus understand vendor replies?
 *
 * Runs agent/lib/classify.ts (the real production classifier, on Nebius Token
 * Factory) over evals/data/vendor-replies.json, scores intent accuracy, writes
 * the summary to KV for /observe, and — when LANGSMITH_API_KEY is set — files
 * the same run as a LangSmith experiment on a dataset it creates on first use.
 *
 *   npm run eval:replies
 */
import { readFileSync } from "node:fs";
import { classifyReply } from "../agent/lib/classify.ts";
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
const model = (process.env.NEBIUS_MODEL ?? "").trim() || "Qwen/Qwen3-235B-A22B-Instruct-2507";
const DATASET = "venus-vendor-replies";

async function classify(c: Case) {
  const { intel, via } = await classifyReply({
    vendorName: c.vendorName,
    replyText: c.replyText,
    originalSubject: c.originalSubject,
  });
  return { intent: intel.intent, sentiment: intel.sentiment, summary: intel.summary, via };
}

const results: EvalCaseResult[] = [];
let heuristicFallbacks = 0;
for (const c of cases) {
  const out = await classify(c);
  if (out.via === "heuristic") heuristicFallbacks += 1;
  const ok = out.intent === c.expected;
  results.push({ name: c.name, expected: c.expected, got: out.intent, ok, note: out.via === "heuristic" ? "(model unreachable — heuristic)" : undefined });
  console.log(`${ok ? "✓" : "✗"} ${c.name.padEnd(28)} expected ${c.expected.padEnd(12)} got ${out.intent.padEnd(12)} ${out.via}`);
}
const passed = results.filter((r) => r.ok).length;
const score = results.length ? passed / results.length : 0;
console.log(`\nintent accuracy ${passed}/${results.length} = ${(score * 100).toFixed(0)}% · model ${model}${heuristicFallbacks ? ` · ${heuristicFallbacks} heuristic fallbacks` : ""}`);

let langsmith: { dataset?: string; experiment?: string; url?: string } | null = null;
if (process.env.LANGSMITH_API_KEY) {
  try {
    const { Client } = await import("langsmith");
    const { evaluate } = await import("langsmith/evaluation");
    const client = new Client();
    if (!(await client.hasDataset({ datasetName: DATASET }))) {
      const ds = await client.createDataset(DATASET, { description: "Labelled vendor replies for Venus's reply classifier." });
      await client.createExamples({
        datasetId: ds.id,
        inputs: cases.map((c) => ({ vendorName: c.vendorName, originalSubject: c.originalSubject ?? "", replyText: c.replyText, name: c.name })),
        outputs: cases.map((c) => ({ intent: c.expected })),
      });
    }
    const exp = await evaluate(
      async (inputs: Record<string, unknown>) =>
        classify({
          name: String(inputs.name ?? ""),
          vendorName: String(inputs.vendorName ?? ""),
          originalSubject: String(inputs.originalSubject ?? ""),
          replyText: String(inputs.replyText ?? ""),
          expected: "",
        }),
      {
        data: DATASET,
        client,
        experimentPrefix: "venus-classify",
        metadata: { model, provider: "nebius-token-factory" },
        evaluators: [
          ({ outputs, referenceOutputs }: { outputs: Record<string, unknown>; referenceOutputs?: Record<string, unknown> }) => ({
            key: "intent_match",
            score: outputs?.intent === referenceOutputs?.intent ? 1 : 0,
          }),
        ],
        maxConcurrency: 2,
      },
    );
    langsmith = { dataset: DATASET, experiment: exp.experimentName };
    console.log(`LangSmith experiment: ${exp.experimentName}`);
  } catch (error) {
    console.warn("LangSmith upload skipped:", (error as Error).message);
  }
} else {
  console.log("LANGSMITH_API_KEY not set — results stay local + KV (no LangSmith experiment).");
}

if (traceConfigured()) {
  await saveEvalSummary({
    kind: "replies",
    name: "Vendor-reply understanding (classifyReply intent)",
    ranAt: new Date().toISOString(),
    model,
    n: results.length,
    passed,
    score,
    cases: results,
    langsmith,
    note: heuristicFallbacks ? `${heuristicFallbacks} heuristic fallbacks` : undefined,
  });
  console.log("saved to KV → /observe");
} else {
  console.log("KV not configured — summary not saved.");
}
