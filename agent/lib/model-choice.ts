/**
 * Which models a visitor may choose for the planner, and what we measured.
 *
 * A free-text model box would be a footgun: this project has already watched
 * one model fail 13% of its structured outputs and another kill 10 of 10
 * specialist sessions. So the list is an allowlist, every entry carries the
 * evidence behind it, and the risky ones say so in the UI rather than in a
 * commit message nobody reads.
 *
 * Only the PLANNER is selectable. The scout is ~80% of a plan's cost and the
 * place where a bad model does real damage, so it stays pinned.
 */

export interface ModelChoice {
  id: string;
  label: string;
  /** Dollars per million tokens, from the generated Token Factory table. */
  price: string;
  /** What was actually measured about this model in this project. */
  evidence: string;
  caution?: string;
}

export const PLANNER_CHOICES: ModelChoice[] = [
  {
    id: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    label: "Qwen3 235B",
    price: "$0.20 / $0.60",
    evidence: "Default. 30/30 on the schema probe, 15/15 on the reply set across three runs.",
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Pro",
    label: "DeepSeek V4 Pro",
    price: "$1.75 / $3.50",
    evidence: "The pinned judge for every eval here. Strongest reasoner in the catalog.",
    caution: "About 9x the input price of the default.",
  },
  {
    id: "zai-org/GLM-5.2",
    label: "GLM 5.2",
    price: "$1.40 / $4.40",
    evidence: "1M context. Scored 93% on the reply set — below the default.",
  },
  {
    id: "moonshotai/Kimi-K2.6",
    label: "Kimi K2.6",
    price: "$0.95 / $4.00",
    evidence: "Not measured here. Included so the swap itself is demonstrable.",
    caution: "Unmeasured on this workload.",
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Flash",
    label: "DeepSeek V4 Flash",
    price: "$0.14 / $0.28",
    evidence: "Cheapest here, and 15/15 on one sweep of the reply set.",
    caution: "Failed 4 of 30 structured-output calls on the schema probe. Expect fallbacks.",
  },
];

const ALLOWED = new Set(PLANNER_CHOICES.map((c) => c.id));

/** Header the browser sends. Anything not on the allowlist is ignored. */
export const MODEL_HEADER = "x-venus-planner-model";

export function sanitizeChoice(value: string | null | undefined): string | null {
  const id = (value ?? "").trim();
  return id && ALLOWED.has(id) ? id : null;
}
