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
  // Owner directive (launch mode): no token gates, no "continue?" pauses —
  // a couple mid-planning must never hit a meter. Runaway protection now
  // lives in the outreach caps + the access-code gate, not session budgets.
  limits: {
    maxInputTokensPerSession: false,
    maxOutputTokensPerSession: false,
  },
});
