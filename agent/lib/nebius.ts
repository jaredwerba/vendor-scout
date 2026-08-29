import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Nebius Token Factory — OpenAI-compatible inference.
 * Base: https://api.tokenfactory.nebius.com/v1
 * Auth: Bearer NEBIUS_API_KEY
 *
 * This is Token Factory, not Nebius AI Cloud. Do not mix the two.
 * Model ids come from GET /v1/models (not Vercel AI Gateway ids).
 */
export const TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1";

/** Default from the live Token Factory catalog (listed 2026-08-28). */
export const DEFAULT_TOKEN_FACTORY_MODEL = "Qwen/Qwen3-235B-A22B-Instruct-2507";

const tokenFactory = createOpenAICompatible({
  name: "token-factory",
  baseURL: TOKEN_FACTORY_BASE_URL,
  // Ask for usage on the streamed final chunk. Without it every streamed turn
  // reports zero tokens, so /observe showed 0 tokens and $0 for every session
  // and there was no way to compare models on cost.
  includeUsage: true,
  // Token Factory honours response_format json_schema (verified 2026-08-28).
  // Without this flag the AI SDK drops the schema on generateObject calls and
  // classifyReply silently falls back to keyword heuristics — the reply eval
  // (npm run eval:replies) is what caught it.
  supportsStructuredOutputs: true,
  // Read the key at request time. createOpenAICompatible would otherwise
  // snapshot process.env at module load (empty during `eve build` / Vercel).
  fetch: (url, init) => {
    const key = process.env.NEBIUS_API_KEY?.trim();
    const headers = new Headers(init?.headers);
    if (key) headers.set("Authorization", `Bearer ${key}`);
    return fetch(url, { ...init, headers });
  },
});

export function tokenFactoryModel(modelId?: string) {
  const raw = modelId ?? process.env.NEBIUS_MODEL ?? DEFAULT_TOKEN_FACTORY_MODEL;
  // Vercel env --value / stdin often stores a trailing newline; Token Factory
  // then 404s chat/completions because the id is not in the catalog.
  const id = raw.trim();
  return tokenFactory.chatModel(id.length > 0 ? id : DEFAULT_TOKEN_FACTORY_MODEL);
}

// Per-role model selection lives in ./models.ts. These re-exports keep the
// existing call sites working and give each one a name that says which job
// it is asking for.
export { modelFor, modelIdFor, contextWindowFor, MODEL_ROLES, modelRouting } from "./models";
