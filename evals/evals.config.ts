import { defineEvalConfig } from "eve/evals";

/**
 * Shared eval defaults. Deterministic assertions only — no LLM judge — so a
 * run needs nothing beyond the agent's own model credentials. Results land
 * under .eve/evals/<timestamp>/ and, via scripts/eval-report.ts, in KV for
 * /observe.
 */
export default defineEvalConfig({
  maxConcurrency: 2,
  timeoutMs: 240_000,
});
