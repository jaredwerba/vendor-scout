import { defineAgent } from "eve";
import { tokenFactoryModel } from "./lib/nebius";

export default defineAgent({
  // Direct Token Factory (OpenAI-compatible). A string id here would route
  // through Vercel AI Gateway — pass a LanguageModel so the call hits
  // https://api.tokenfactory.nebius.com/v1 with NEBIUS_API_KEY.
  // Override the catalog id with NEBIUS_MODEL. Web search stays Tavily
  // (tools/web_search.ts), so the brain swap does not drop research.
  model: tokenFactoryModel(),
  // Owner directive (launch mode): no token gates, no "continue?" pauses —
  // a couple mid-planning must never hit a meter. Runaway protection now
  // lives in the outreach caps + the daily request cap in channels/eve.ts
  // (Venus is public — no access code), not session budgets.
  limits: {
    maxInputTokensPerSession: false,
    maxOutputTokensPerSession: false,
  },
});
