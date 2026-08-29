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
import { TOKEN_FACTORY_PRICING } from "./pricing.generated";

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
 * (`npm run models:compare`), one pass per model. Accuracy first, then cost:
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
 *
 * The sharpest lesson came from acting on it too fast. DeepSeek-V4-Flash won
 * that sweep at 15/15, so the classifier was switched to it — and the very
 * next run of the same 15 cases scored 11/15 with six schema failures.
 *
 * `npm run probe:schema` then settled it, and it was not noise: over 30
 * structured-output calls each,
 *
 *   Qwen/Qwen3-235B-A22B-Instruct-2507    0/30 failed
 *   deepseek-ai/DeepSeek-V4-Flash         4/30 failed (13%)
 *     2× "the model did not return a response"
 *     2× "could not parse the response"
 *
 * An accuracy sweep cannot see this: a call that never returns an object is
 * not a wrong answer, it is no answer, and it reads as a tie. Reliability of
 * the shape is a separate axis from correctness of the content, and for a
 * job reading untrusted email it is the one that matters more.
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
    model: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    env: "NEBIUS_SCOUT_MODEL",
    contextWindow: 262_144,
    rationale:
      "Reverted from DeepSeek-V4-Flash after eval:scout: 10/10 specialist sessions failed and " +
      "not one recorded a vendor, against 46/50 and 3-4 vendors each on Qwen. The cost case for " +
      "the cheaper model was real; it just does not finish the job. Re-test any candidate with " +
      "npm run eval:scout before it takes this role — the specialists are ~80% of a plan's cost, " +
      "so the incentive to swap here is exactly why it needs the strictest evidence.",
  },

  /**
   * Vendor-reply understanding: one structured-output call per reply, high
   * volume over a wedding's life, and the input is untrusted email from the
   * open internet. Small and fast is right IF accuracy holds — and there is a
   * 15-case labelled set with ground truth to prove it either way, which is
   * what `npm run models:compare` runs.
   */
  classifier: {
    model: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    env: "NEBIUS_CLASSIFIER_MODEL",
    contextWindow: 262_144,
    rationale:
      "Structured output on untrusted email. Qwen has now scored 15/15 on the labelled set on " +
      "three separate runs. DeepSeek-V4-Flash scored 15/15 in one sweep and then 11/15 with six " +
      "schema failures on the very next run of the same cases — so the sweep was under-powered, " +
      "not decisive. Reliability of the structured output matters more here than the 16% of a " +
      "fraction of a cent that separates them.",
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

/**
 * The catalog id serving a role right now (env override wins).
 *
 * An unknown id stops the process. Sentinel's blueprint carries the same
 * guard with the reason attached: a typo'd model id used to fall back
 * silently to a different model, "so you could benchmark the wrong model
 * without noticing". That is worse here than there — every number in the
 * V1-to-V2 comparison is attributed to a named model, and a silent fallback
 * would make those attributions quietly false.
 *
 * The price table is this project's snapshot of the catalog, so an unknown id
 * means a typo or a stale table. Both are fixed in one command; both deserve
 * a stop rather than a shrug.
 */
export function modelIdFor(role: ModelRole): string {
  const spec = MODEL_ROLES[role];
  const id = (process.env[spec.env] ?? "").trim() || spec.model;
  assertKnownModel(id, spec.env);
  return id;
}

const KNOWN = new Set(Object.keys(TOKEN_FACTORY_PRICING));

function assertKnownModel(id: string, envVar: string): void {
  if (KNOWN.has(id) || process.env.NEBIUS_ALLOW_UNKNOWN_MODEL === "1") return;
  const lower = id.toLowerCase();
  const near = [...KNOWN]
    .filter((k) => {
      const t = k.toLowerCase();
      return t.includes(lower) || lower.includes(t.split("/").pop() ?? t);
    })
    .slice(0, 3);
  throw new Error(
    `${envVar}="${id}" is not in the Token Factory catalog snapshot.\n` +
      (near.length ? `  Did you mean: ${near.join(", ")}?\n` : "") +
      "  If the model is new, refresh the snapshot: npm run pricing:refresh\n" +
      "  To proceed anyway (cost will report as $0): NEBIUS_ALLOW_UNKNOWN_MODEL=1",
  );
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
