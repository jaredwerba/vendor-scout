/**
 * Which model does which job.
 *
 * Running one model for everything is the prototype configuration. The point
 * of Token Factory is that a model is a line of config, so the roles below
 * are separated by what each job actually demands — and, where a fixed eval
 * exists to decide it, chosen on measured evidence rather than reputation
 * (`npm run models:compare`).
 *
 * Every role is env-overridable, so a swap is still one line, and
 * /observe reports which model served which role on any given run.
 */

import { tokenFactoryModel } from "./nebius";

export type ModelRole = "planner" | "scout" | "classifier" | "judge";

export interface RoleSpec {
  /** The catalog id serving this role by default. */
  model: string;
  /** Env var that overrides it. */
  env: string;
  /** Context window of the default, for defineAgent. */
  contextWindow: number;
  /** What this job demands, and why this model answers it. */
  rationale: string;
}

/**
 * Measured on the 15 labelled vendor replies, 2026-08-29
 * (`npm run models:compare`). Accuracy first, then cost for the whole set:
 *
 *   deepseek-ai/DeepSeek-V4-Flash        100%   $0.0020   1570ms
 *   Qwen/Qwen3-235B-A22B-Instruct-2507   100%   $0.0023   1203ms
 *   zai-org/GLM-5.3-Flash                 93%   $0.0041   2633ms
 *   nvidia/Nemotron-3_5-Lightning         80%   $0.0077   6613ms
 *   Qwen/Qwen3-30B-A3B-Instruct-2507      73%   $0.0013   1851ms
 *
 * Two things worth keeping from that run. The cheapest model per token
 * (Nemotron-3.5-Lightning, $0.06/$0.24) was the most expensive per run and
 * five times slower, because price per token is not cost — output volume is.
 * And the cheapest per run (Qwen3-30B) got 73%, which on untrusted vendor
 * email means misfiled replies and follow-ups chasing someone who already
 * said yes.
 */
export const MODEL_ROLES: Record<ModelRole, RoleSpec> = {
  /**
   * Venus herself: holds the whole conversation, orchestrates the fan-out,
   * writes the three visions and every vendor email. This is the couple's
   * entire experience of the product and roughly 15% of a plan's cost, so it
   * is the one role where quality outranks price. Unchanged until an eval
   * measures prose and orchestration quality — swapping the voice of the
   * product on a hunch is exactly the move this registry exists to prevent.
   */
  planner: {
    model: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    env: "NEBIUS_MODEL",
    contextWindow: 262_144,
    rationale:
      "Conversational quality and reliable multi-tool orchestration. ~15% of plan cost but " +
      "100% of what the couple reads. Held constant until an eval can measure the swap.",
  },

  /**
   * The research specialists. 20-40 steps each, 400k-900k input tokens, heavy
   * tool calling — and roughly 80% of what a plan costs, because every step
   * re-sends the growing transcript. That makes INPUT price and context
   * length the dominant terms, not output quality.
   *
   * DeepSeek-V4-Flash: $0.14/$0.28 per Mtok against Qwen's $0.20/$0.60, with
   * a 1M context instead of 262k. Cheaper on the axis that dominates, with
   * four times the headroom for a long research loop. This is the same
   * substitution Nebius's own production write-up made for the heavy tier.
   */
  scout: {
    model: "deepseek-ai/DeepSeek-V4-Flash",
    env: "NEBIUS_SCOUT_MODEL",
    contextWindow: 1_048_576,
    rationale:
      "Cost is dominated by input tokens across 20-40 steps: $0.14/$0.28 vs $0.20/$0.60, and a " +
      "1M window vs 262k for a long tool loop. Verified against the scout eval, not assumed.",
  },

  /**
   * Vendor-reply understanding: one structured-output call per reply, high
   * volume over a wedding's life, and the input is untrusted email from the
   * open internet. Small and fast is right IF accuracy holds — and there is a
   * 15-case labelled set with ground truth to prove it either way, which is
   * what `npm run models:compare` runs.
   */
  classifier: {
    model: "deepseek-ai/DeepSeek-V4-Flash",
    env: "NEBIUS_CLASSIFIER_MODEL",
    contextWindow: 1_048_576,
    rationale:
      "Measured on the 15 labelled replies (npm run models:compare, 2026-08-29): 15/15 at " +
      "$0.13 per 1k replies, tied with Qwen3-235B on accuracy and 16% cheaper. The set does not " +
      "separate the two — it proves neither is worse — so the tiebreak is cost, plus one fewer " +
      "model in the stack and a 1M window for long quoted email threads.",
  },

  /**
   * The grader. Deliberately stronger and deliberately never the model under
   * test: grading with the thing being measured moves the bar along with it,
   * and every model comparison becomes meaningless.
   */
  judge: {
    model: "deepseek-ai/DeepSeek-V4-Pro",
    env: "NEBIUS_JUDGE_MODEL",
    contextWindow: 1_048_576,
    rationale:
      "Strongest general reasoner in the catalog at a price an eval can afford. Pinned away " +
      "from every other role so a model swap can never change how results are graded.",
  },
};

/** The catalog id serving a role right now (env override wins). */
export function modelIdFor(role: ModelRole): string {
  const spec = MODEL_ROLES[role];
  return (process.env[spec.env] ?? "").trim() || spec.model;
}

/** A ready LanguageModel for a role. */
export function modelFor(role: ModelRole) {
  return tokenFactoryModel(modelIdFor(role));
}

export function contextWindowFor(role: ModelRole): number {
  return MODEL_ROLES[role].contextWindow;
}

/** What /observe and the rail report about the current routing. */
export function modelRouting() {
  return (Object.keys(MODEL_ROLES) as ModelRole[]).map((role) => ({
    role,
    model: modelIdFor(role),
    overridden: modelIdFor(role) !== MODEL_ROLES[role].model,
    rationale: MODEL_ROLES[role].rationale,
  }));
}
