import { defineEvalConfig } from "eve/evals";
import { judgeModel } from "../agent/lib/nebius";

/**
 * Shared eval defaults.
 *
 * The judge is pinned to its own Token Factory model (NEBIUS_JUDGE_MODEL,
 * default DeepSeek-V4-Pro) rather than inheriting the agent's. Grading with
 * the model under test makes every model comparison meaningless — the bar
 * moves with the thing being measured.
 *
 * `--tag fast` runs the deterministic suite; the slow evals drive full
 * planning turns and cost real research credits. Results land under
 * .eve/evals/<timestamp>/ and, via scripts/eval-report.ts, in KV for /observe.
 */
export default defineEvalConfig({
  maxConcurrency: 2,
  timeoutMs: 240_000,
  judge: { model: judgeModel() },
});
