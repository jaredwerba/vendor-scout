/**
 * Publish the latest `eve eval` run to KV so /observe can show it.
 * Reads the newest .eve/evals/<timestamp>/summary.json + results.jsonl.
 *
 *   npm run eval && npm run eval:report
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type EvalCaseResult, saveEvalSummary, traceConfigured } from "../agent/lib/trace.ts";

const root = join(process.cwd(), ".eve", "evals");
if (!existsSync(root)) { console.error("no .eve/evals runs found — run `npm run eval` first"); process.exit(1); }
const runs = readdirSync(root).filter((d) => existsSync(join(root, d, "summary.json"))).sort();
const latest = runs[runs.length - 1];
if (!latest) { console.error("no completed eval run found"); process.exit(1); }
const dir = join(root, latest);
// biome-ignore lint/suspicious/noExplicitAny: eve-owned artifact shape
const summary: any = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
// biome-ignore lint/suspicious/noExplicitAny: eve-owned artifact shape
const rows: any[] = existsSync(join(dir, "results.jsonl"))
  ? readFileSync(join(dir, "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];
const cases: EvalCaseResult[] = rows.map((r) => {
  const verdict = String(r.verdict ?? r.status ?? r.outcome ?? "?");
  return {
    name: String(r.id ?? r.evalId ?? r.name ?? "eval"),
    expected: "passed",
    got: verdict,
    ok: /pass|scored|ok/i.test(verdict) && !/fail/i.test(verdict),
    note: r.error ? String(r.error).slice(0, 120) : undefined,
  };
});
const passed = cases.filter((c) => c.ok).length;
const model = (process.env.NEBIUS_MODEL ?? "").trim() || "Qwen/Qwen3-235B-A22B-Instruct-2507";
console.log(`eve eval run ${latest}: ${passed}/${cases.length} passed`);
if (!traceConfigured()) { console.log("KV not configured — not saved."); process.exit(0); }
await saveEvalSummary({
  kind: "eve",
  name: "eve evals — live agent over HTTP (evals/*.eval.ts)",
  ranAt: new Date().toISOString(),
  model,
  n: cases.length,
  passed,
  score: cases.length ? passed / cases.length : 0,
  cases,
  langsmith: null,
  note: `run ${latest}${summary?.passed !== undefined ? ` · summary passed=${summary.passed}` : ""}`,
});
console.log("saved to KV → /observe");
