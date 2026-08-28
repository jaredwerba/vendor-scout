import { defineAgent } from "eve";
import { tokenFactoryModel } from "./lib/nebius";

export default defineAgent({
  // Direct Token Factory (OpenAI-compatible). A string id here would route
  // through Vercel AI Gateway — pass a LanguageModel so the call hits
  // https://api.tokenfactory.nebius.com/v1 with NEBIUS_API_KEY.
  // Override the catalog id with NEBIUS_MODEL. Web search stays Tavily
  // (tools/web_search.ts), so the brain swap does not drop research.
  // Eve compaction needs an explicit window: Token Factory ids are not in
  // the AI Gateway catalog. 262144 is GET /v1/models?verbose=true
  // context_length for Qwen/Qwen3-235B-A22B-Instruct-2507.
  model: tokenFactoryModel(),
  modelContextWindowTokens: 262_144,
  // Owner directive (launch mode): no token gates, no "continue?" pauses —
  // a couple mid-planning must never hit a meter. Runaway protection now
  // lives in the outreach caps + the daily request cap in channels/eve.ts
  // (Venus is public — no access code), not session budgets.
  limits: {
    maxInputTokensPerSession: false,
    maxOutputTokensPerSession: false,
  },
});
