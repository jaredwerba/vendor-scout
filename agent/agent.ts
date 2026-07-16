import { defineAgent } from "eve";

export default defineAgent({
  // Routed through the Vercel AI Gateway. Muse Spark 1.1 (Meta, July 2026) is
  // the cost-efficient workhorse: ~2.5-3x cheaper than Sonnet-5 and built for
  // agentic tool use. Web search is our own Tavily-backed tool (see
  // tools/web_search.ts), so research no longer depends on the model vendor.
  // Baseline for quality comparison: anthropic/claude-sonnet-5 (M1 runs).
  model: "meta/muse-spark-1.1",
  reasoning: "medium",
  // Safety net so a runaway session can't rack up a surprise bill during demos.
  limits: {
    maxInputTokensPerSession: 3_000_000,
    maxOutputTokensPerSession: 100_000,
  },
});
