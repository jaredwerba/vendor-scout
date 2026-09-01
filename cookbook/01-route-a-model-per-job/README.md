# Foundation — Route a Model per Job

> Each role has one model. Each swap is one line of configuration, and an eval can veto it.

Recipe **01 of 10** in the Venus Blueprint Recipes arc:

> **Foundation** → Delegation → Durability → Guards → Governance → Cost → Latency → Observability → Evaluation → Verification

A prototype configuration runs one model for every job. This configuration survives because no code disagrees with it. Every call site names the same environment variable. Thus nobody asks which model does each job. Nobody writes the answer down where a reviewer can examine it.

Then the question comes up in the worst possible way. One sweep over fifteen labelled vendor replies ranked a cheaper model first on accuracy and on cost. The team switched the classifier to that model. The next run used the same fifteen cases and the same prompt:

```text
First sweep: 15/15 | Next run, same cases: 11/15 | Schema failures: 6
```

The saving was real. The tie was not.

A better model does not fix this. A permanent home for the question fixes it. A per-role registry holds the choice, the override, the context window, and the *reason* in one struct. One function resolves every id. An unknown id stops the process and does not become a different id.

## What you'll build

```
agent/lib/
  models.ts                    # MODEL_ROLES — four roles, four specs, one resolver
  nebius.ts                    # the Token Factory client every role shares
  pricing.generated.ts         # catalog snapshot; doubles as the allowlist
  classify.ts                  # the one call site that accepts a modelId override
scripts/
  compare-models.ts            # npm run models:compare — accuracy, cost, latency
  probe-structured-output.ts   # npm run probe:schema  — does the shape come back
evals/data/
  vendor-replies.json          # 15 labelled replies, held constant across swaps
```

## Prerequisites

- Node 24.x. The repo pins it in `engines`. The scripts run through `node --env-file=.env.local --import ./scripts/ts-resolve.mjs`.
- `npm install` at the repo root.
- A Nebius Token Factory key as `NEBIUS_API_KEY` in `.env.local`. This is Token Factory (`https://api.tokenfactory.nebius.com/v1`), not Nebius AI Cloud. The model ids come from its `GET /v1/models`.
- A current price table. `npm run pricing:refresh` regenerates [`agent/lib/pricing.generated.ts`](../../agent/lib/pricing.generated.ts) from `GET /v1/models?verbose=true`.
- A labelled set for at least one role. This recipe uses fifteen real vendor replies with ground-truth intents in [`evals/data/vendor-replies.json`](../../evals/data/vendor-replies.json).

## Run it

These commands run the deployed registry. There is no separate sample app to clone. The files under **What you'll build** serve production.

```bash
npm install

# Which model is doing which job right now. No API key needed.
node --import ./scripts/ts-resolve.mjs --input-type=module -e '
import { modelRouting } from "./agent/lib/models.ts";
for (const r of modelRouting()) console.log(r.role.padEnd(11), r.model);
'
```

```text
planner     Qwen/Qwen3-235B-A22B-Instruct-2507
scout       Qwen/Qwen3-235B-A22B-Instruct-2507
classifier  Qwen/Qwen3-235B-A22B-Instruct-2507
judge       deepseek-ai/DeepSeek-V4-Pro
```

Now mistype one character of an override and ask again:

```bash
NEBIUS_CLASSIFIER_MODEL="Qwen/Qwen3-235B-A22B-Instruc" \
node --import ./scripts/ts-resolve.mjs --input-type=module -e '
import { modelIdFor } from "./agent/lib/models.ts";
modelIdFor("classifier");
'
```

```text
Error: NEBIUS_CLASSIFIER_MODEL="Qwen/Qwen3-235B-A22B-Instruc" is not in the Token Factory catalog snapshot.
  Did you mean: Qwen/Qwen3-235B-A22B-Instruct-2507?
  If the model is new, refresh the snapshot: npm run pricing:refresh
  To proceed anyway (cost will report as $0): NEBIUS_ALLOW_UNKNOWN_MODEL=1
```

## Walk-through

### One client, four callers

Every role shares one OpenAI-compatible client in [`agent/lib/nebius.ts`](../../agent/lib/nebius.ts). Three of its options exist because, without them, a fault occurred and gave no error.

```ts
const tokenFactory = createOpenAICompatible({
  name: "token-factory",
  baseURL: TOKEN_FACTORY_BASE_URL,
  includeUsage: true,
  supportsStructuredOutputs: true,
  fetch: (url, init) => { /* read NEBIUS_API_KEY at request time */ },
});
```

`includeUsage` requests the usage block on the final streamed chunk. Without it, every streamed turn reports zero tokens. The console then shows `$0` for every session, and no cost data exists for a comparison. A comparison whose cost column is always zero is not a cheap comparison. It is a broken comparison.

`supportsStructuredOutputs` tells the AI SDK that Token Factory accepts `response_format` `json_schema`. Without the flag, the SDK removes the schema from `generateObject`. Then [`classifyReply`](../../agent/lib/classify.ts) falls back to its keyword heuristic. The heuristic returns a plausible object and no error. The reply eval found this fault, not a stack trace.

The `fetch` wrapper reads the key for each request. Without the wrapper, `createOpenAICompatible` copies `process.env` at module load. That copy is empty during `eve build` and on Vercel.

`tokenFactoryModel` also trims the id. When `vercel env` stores a value from stdin, the value keeps a trailing newline. Token Factory then returns 404 on `chat/completions` for an id that looks correct in the dashboard. Each defence is one line. Each stops a failure that looks like a model fault but is a configuration fault.

### The registry is the argument, not the value

[`agent/lib/models.ts`](../../agent/lib/models.ts) declares four roles. Each spec carries more than an id:

```ts
export type ModelRole = "planner" | "scout" | "classifier" | "judge";

export interface RoleSpec {
  model: string;          // the catalog id serving this role by default
  env: string;            // env var that overrides it
  contextWindow: number;  // context window of the default, for defineAgent
  rationale: string;      // what this job demands, and why this model answers it
}
```

**The `rationale` field is not a comment.** `modelRouting()` returns it with the live id. [`app/observe/page.tsx`](../../app/observe/page.tsx) renders it as a column beside each role. The [observability rail](../../app/_components/observability-rail.tsx) on the home page shows it as the hover title on each role. When the reason ships next to the choice, a reader can see when the reason is out of date.

The four jobs have different demands, and the registry records them. The `planner` is the voice of Venus and its orchestrator. The planner causes a small share of a plan's cost, but the couple reads all of its output. Thus its model stays constant until an eval can measure prose quality.

The `scout` runs long tool loops, and each step sends a growing transcript again. Thus input price and context length are the dominant costs for the scout. The `classifier` makes one structured-output call per reply, on untrusted email from the open internet. The `judge` grades the other roles.

**The judge is pinned to a different model from every other role, on purpose.** When the model under test grades itself, the standard moves with the model. Every later comparison then measures nothing. The judge is the role whose id must change least often and for the fewest reasons.

### One door in, one door out

```ts
export function modelIdFor(role: ModelRole): string {
  const spec = MODEL_ROLES[role];
  const id = (process.env[spec.env] ?? "").trim() || spec.model;
  assertKnownModel(id, spec.env);
  return id;
}
```

All other functions build on this one. `modelFor(role)` wraps it into a `LanguageModel`. `contextWindowFor(role)` feeds `defineAgent`. `modelRouting()` reports it. The override wins, so a swap is one line.

The function reads the override at call time, not at module load. Thus an override set in the deployment environment applies without a rebuild. `modelRouting()` also returns an `overridden` flag with the id. When a role does not run on its declared default, the page shows this fact, not a shell history.

### The price table is the allowlist

```ts
const KNOWN = new Set(Object.keys(TOKEN_FACTORY_PRICING));

function assertKnownModel(id: string, envVar: string): void {
  if (KNOWN.has(id) || process.env.NEBIUS_ALLOW_UNKNOWN_MODEL === "1") return;
  // ...suggest near matches, then throw
}
```

**Why does a typo stop the process?** The alternative is the anti-pattern. A mistyped id falls through to a default, and the run completes. Sentinel's blueprint carries the same guard with the reason attached: a silent fallback lets *you benchmark the wrong model and not notice*. This repository attributes every published number to a named model. A silent fallback makes the attribution false while the dashboard stays green.

The price table is the correct allowlist because cost accounting reads the same table. An id that is not in the table is a typo, or the table is stale. The error names both fixes and the escape option. The escape option reports cost as `$0` and says so.

### Two swaps the registry refused

The classifier sweep ran one pass per candidate over the fifteen labelled replies, on 2026-08-29:

```text
deepseek-ai/DeepSeek-V4-Flash        100% | $0.0020 | 1570ms
Qwen/Qwen3-235B-A22B-Instruct-2507   100% | $0.0023 | 1203ms
zai-org/GLM-5.3-Flash                 93% | $0.0041 | 2633ms
nvidia/Nemotron-3_5-Lightning         80% | $0.0077 | 6613ms
Qwen/Qwen3-30B-A3B-Instruct-2507      73% | $0.0013 | 1851ms
```

Read the bottom two rows before the top two. The candidate with the lowest published per-token rate produced the most expensive run and the slowest median latency. Price per token is not cost. Output volume drives cost. The cheapest run got the worst score. On untrusted vendor email, a bad score causes misfiled replies and follow-up email to a vendor who already agreed.

The action on the top row taught the sharper lesson. The team made the switch and ran the same fifteen cases again. The result is the text block at the top of this page. The team wrote [`scripts/probe-structured-output.ts`](../../scripts/probe-structured-output.ts) to test whether that result was noise. The script makes thirty structured-output calls per model and scores only whether an object comes back:

```text
Qwen/Qwen3-235B-A22B-Instruct-2507   0/30 failed
deepseek-ai/DeepSeek-V4-Flash        4/30 failed | 2× "the model did not return a response" | 2× "could not parse the response"
```

**An accuracy sweep cannot see this fault.** A call that returns no object is not a wrong answer. It is no answer. When the average includes it, the score shows a tie. Correctness of the content and reliability of the shape are different axes. For a job that reads untrusted email, the second axis decides.

The `scout` role also refused a swap, and its record shows a weakness in the registry. The cost argument was strong. The scout sessions dominate a plan's spend. The cheaper candidate has a lower input price and four times the context window. But `npm run eval:scout` reported that every scout session failed with not one vendor recorded, against a 46/50 baseline.

The decision record states that the model was **not the only cause**. The subagent also carried an `outputSchema`, which eve escalates to `OUTPUT_SCHEMA_NOT_FULFILLED`, and this stops the child session. The registry recorded a verdict from an experiment with two changed variables. Know this about your own evidence.

### The harness that learned from being wrong

[`scripts/compare-models.ts`](../../scripts/compare-models.ts) now runs three rounds by default and ranks on the worst round:

```ts
const ROUNDS = Number(process.env.COMPARE_ROUNDS ?? 3);
// …
rows.sort((a, b) => b.worstScore - a.worstScore || b.score - a.score || a.costUsd - b.costUsd);
// …
const cheapestPerfect = rows.filter((r) => r.worstScore === 1).sort((a, b) => a.costUsd - b.costUsd)[0];
```

**Rank on the worst round, not the mean.** A mean hides the bad round, and the bad round is the entire signal. The default is three rounds because one pass over fifteen cases only removes the clearly worse candidates. One pass cannot separate two candidates near the top. The last line of the script tells you to run the sweep again before a switch. The first sweep did not give that advice.

Two failures stay open. Test a new model for the `scout` role with `npm run eval:scout` before the model takes the job. No code enforces this test. Only the rationale string asks for it.

Also, after the classifier revert, the team did not run the eval again. The console then served the summary of the losing model. The console reported a score for a configuration that was hours out of date. The structural fix is a console flag on each eval summary whose recorded model does not match live routing. This fix is recommended and not yet built. Observability that reports false data is worse than no observability, and here it reported false data about itself.

### Where this transfers

The point is not weddings only. The pattern applies to each domain where one system does several jobs with different demands. In such a domain, one job makes a structured artifact that a later step uses. Triage of insurance claims runs a cheap extractor over documents and an expensive reasoner over edge cases. Routing of support tickets classifies at volume and drafts at quality. Intake of clinical or legal documents needs the schema obeyed every time and can accept a slower model.

Triage of logs and alerts has the same shape with a harder latency budget. In each domain, the cheap-swap argument is *correct about cost* and still loses. Only three things catch it: a fixed labelled set, more than one round, and a grader pinned to a separate model.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| `NEBIUS_MODEL="…" is not in the Token Factory catalog snapshot` | Typo in an override, or the price table is older than the catalog | `npm run pricing:refresh`; the error also suggests near matches. `NEBIUS_ALLOW_UNKNOWN_MODEL=1` proceeds and reports cost as `$0` |
| Every session reports zero tokens and `$0` | Streamed turns omit the usage block unless asked | `includeUsage: true` on the client in `agent/lib/nebius.ts` |
| Classifications look keyword-shaped and `via` comes back `heuristic` | The SDK dropped the JSON schema, so `classifyReply` fell through to its fallback | `supportsStructuredOutputs: true`; `npm run eval:replies` is what surfaces it |
| `404` on `chat/completions` for an id that looks correct | Trailing newline stored by `vercel env` from stdin | `tokenFactoryModel` trims the id before use |
| Requests go out unauthenticated during `eve build` or on Vercel | `createOpenAICompatible` snapshots `process.env` at module load, when the key is not yet set | The `fetch` wrapper reads `NEBIUS_API_KEY` per request instead |
| A candidate wins one sweep and fails the next | One pass over a small labelled set cannot separate two models near the top | Three rounds by default; rank on `worstScore`, not the mean |
| Two models tie on accuracy but one is unusable | An unreturned object scores as no answer, not a wrong answer | `npm run probe:schema` measures shape reliability as its own axis |
| The console reports a model that is no longer routed | An eval summary in KV outlives the revert that invalidated it | Re-run the eval. The automatic mismatch check is not built |

## Test it

```bash
npm run models:compare   # three rounds × fifteen labelled replies × each candidate
npm run probe:schema     # thirty structured-output calls per model, shape only
npm run eval:replies     # the routed classifier against the labelled set
npm run typecheck        # ModelRole is a union — an unrouted role will not compile
```

The proof is narrow, so state it precisely. The two harnesses hold the labelled set and the prompt constant and change exactly one line of configuration. Thus a difference between candidates comes from the candidate. The harnesses do not prove that the current model is the best available model. They prove only that the team measured the two attempted swaps and refused them on evidence that a single pass hides.

## Going further

- **Give the planner an eval before you touch it.** The planner is the only role kept constant on judgement, not on measurement, and its rationale says so. This file exists to prevent a swap of the product's voice without evidence.
- **Make the rationale expire.** The strings in `MODEL_ROLES` cite runs by eval name and score, and the date sits in a comment above them. No check confirms that the run still exists or still shows that result. A rationale that has become false is harder to find than a missing rationale.
- **Close the loop between the eval record and live routing.** Every eval summary stores the model that it ran on. Compare that model against `modelIdFor(role)` at render time. This check finds a reverted model at the next render, not hours later.
- **Separate the variables before you record a verdict.** The `scout` revert combined a model change with a subagent `outputSchema` change. The registry recorded a clean conclusion from an experiment that was not clean.
- **Next: [Delegation — Give the Specialist a Smaller Tool Surface](../02-a-smaller-tool-surface/README.md)** — this recipe shows a role that becomes a sub-agent with its own session, its own tool surface, and its own failure modes.

## License


This recipe is part of the [Venus](../../README.md) repository. The repository has no LICENSE file, so it grants no reuse rights by default.
