/**
 * Cost accounting for Nebius Token Factory.
 *
 * Token Factory's OpenAI-compatible responses carry token counts but no
 * price, so eve's `step.completed.usage.costUsd` is always undefined and
 * every dollar figure in the trace store has to be derived here. The table
 * is a snapshot of `GET /v1/models?verbose=true` (dollars per MILLION
 * tokens); refresh it with `npm run pricing:refresh`.
 *
 * Cached input is billed at the prompt rate on Token Factory today — if that
 * changes, split the rate here, not at the call sites.
 */
import { TOKEN_FACTORY_PRICING } from "./pricing.generated";
import type { ActionUsage } from "./actions";

export { TOKEN_FACTORY_PRICING };

export interface ModelPrice {
  in: number;
  out: number;
  context: number;
}

export function priceFor(modelId: string | null | undefined): ModelPrice | null {
  const id = (modelId ?? "").trim();
  if (!id) return null;
  return TOKEN_FACTORY_PRICING[id] ?? null;
}

/** Dollars for one step's usage on `modelId`. 0 when the model is unknown. */
export function costFor(modelId: string | null | undefined, usage: Partial<ActionUsage>): number {
  const price = priceFor(modelId);
  if (!price) return 0;
  const input = (Number(usage.inputTokens ?? 0) || 0) + (Number(usage.cacheReadTokens ?? 0) || 0);
  const output = Number(usage.outputTokens ?? 0) || 0;
  return (input * price.in + output * price.out) / 1e6;
}

/** "$0.0043" / "$1.27" — cost is usually cents, so never round it to nothing. */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
