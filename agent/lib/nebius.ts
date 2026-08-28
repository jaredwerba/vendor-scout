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
  // Read the key at request time. createOpenAICompatible would otherwise
  // snapshot process.env at module load (empty during `eve build` / Vercel).
  fetch: (url, init) => {
    const key = process.env.NEBIUS_API_KEY;
    const headers = new Headers(init?.headers);
    if (key) headers.set("Authorization", `Bearer ${key}`);
    return fetch(url, { ...init, headers });
  },
});

export function tokenFactoryModel(modelId?: string) {
  return tokenFactory.chatModel(modelId ?? process.env.NEBIUS_MODEL ?? DEFAULT_TOKEN_FACTORY_MODEL);
}
