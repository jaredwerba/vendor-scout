import { defineAgent } from "eve";

export default defineAgent({
  // Routed through the Vercel AI Gateway. Sonnet-5 is the reliable default:
  // meta/muse-spark-1.1 proved ~3x cheaper on the same brief (2026-07-15 A/B)
  // but is rate-limited on the gateway's free-credit tier, crashing long
  // research turns. Flip this one line back to "meta/muse-spark-1.1" once
  // paid gateway credits are added. Web search stays our own Tavily-backed
  // tool (tools/web_search.ts) either way, so the model swap is safe anytime.
  model: "anthropic/claude-sonnet-5",
  reasoning: "medium",
  // Safety net so a runaway session can't rack up a surprise bill during demos.
  limits: {
    maxInputTokensPerSession: 3_000_000,
    maxOutputTokensPerSession: 100_000,
  },
});
