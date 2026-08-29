import { defineAgent } from "eve";
import { contextWindowFor, modelFor } from "./lib/models";

export default defineAgent({
  // Direct Token Factory (OpenAI-compatible). A string id here would route
  // through Vercel AI Gateway — pass a LanguageModel so the call hits
  // https://api.tokenfactory.nebius.com/v1 with NEBIUS_API_KEY.
  //
  // The "planner" role is Venus's own voice: see agent/lib/models.ts for why
  // each role runs the model it does. Web search stays Tavily
  // (tools/web_search.ts), so a brain swap never costs us research.
  // eve compaction needs an explicit window because Token Factory ids are not
  // in the AI Gateway catalog.
  model: modelFor("planner"),
  modelContextWindowTokens: contextWindowFor("planner"),
  // Owner directive (launch mode): no token gates, no "continue?" pauses —
  // a couple mid-planning must never hit a meter. Runaway protection now
  // lives in the outreach caps + the daily request cap in channels/eve.ts
  // (Venus is public — no access code), not session budgets.
  limits: {
    maxInputTokensPerSession: false,
    maxOutputTokensPerSession: false,
  },
});
