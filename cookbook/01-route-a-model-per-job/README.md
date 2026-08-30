# Foundation — Route a Model per Job

> One model per role, each swap a line of configuration an eval can veto.

Recipe **01 of 10** in the Venus Blueprint Recipes arc:

> **Foundation** → Delegation → Durability → Guards → Governance → Cost → Latency → Observability → Evaluation → Verification

Running one model for everything is the prototype configuration. It survives because nothing in the code disagrees with it: every call site names the same environment variable, so the question "which model does this job" never gets asked, and the answer is never written down anywhere a reviewer can argue with.

Then the question gets asked in the worst possible way. A sweep over fifteen labelled vendor replies ranked a cheaper model first on accuracy and on cost, so the reply classifier was switched to it. The very next run, same fifteen cases, same prompt:

```text
First sweep: 15/15 | Next run, same cases: 11/15 | Schema failures: 6
```

The saving was real. The tie was not.

What fixes this is not a better model. It is a place for the question to live: a per-role registry where the choice, the environment override, the context window and the *reason* sit in one struct, resolution runs through one function, and an unknown id stops the process instead of quietly becoming something else.

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

- Node 24.x — the repo pins it in `engines`, and the scripts run through `node --env-file=.env.local --import ./scripts/ts-resolve.mjs`.
- `npm install` at the repo root.
- A Nebius Token Factory key as `NEBIUS_API_KEY` in `.env.local`. This is Token Factory (`https://api.tokenfactory.nebius.com/v1`), not Nebius AI Cloud, and the model ids come from its own `GET /v1/models`.
- A current price table. `npm run pricing:refresh` regenerates [`agent/lib/pricing.generated.ts`](../../agent/lib/pricing.generated.ts) from `GET /v1/models?verbose=true`.
- A labelled set for at least one role. Here it is fifteen real vendor replies with ground-truth intents in [`evals/data/vendor-replies.json`](../../evals/data/vendor-replies.json).

## Run it

These commands run the registry that is deployed. There is no separate sample app to clone — the files under **What you'll build** are the ones serving production.

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

Every role shares a single OpenAI-compatible client in [`agent/lib/nebius.ts`](../../agent/lib/nebius.ts). Three of its options exist because something went silently wrong without them.

```ts
const tokenFactory = createOpenAICompatible({
  name: "token-factory",
  baseURL: TOKEN_FACTORY_BASE_URL,
  includeUsage: true,
  supportsStructuredOutputs: true,
  fetch: (url, init) => { /* read NEBIUS_API_KEY at request time */ },
});
```

`includeUsage` asks for the usage block on the streamed final chunk. Without it every streamed turn reports zero tokens, so the console shows `$0` for every session and there is nothing to compare models *on*. A model comparison whose cost column is structurally zero is not a cheap comparison, it is a broken one.

`supportsStructuredOutputs` tells the AI SDK that Token Factory honours `response_format` `json_schema`. Without the flag the SDK drops the schema on `generateObject`, and [`classifyReply`](../../agent/lib/classify.ts) falls back to its keyword heuristic — a fallback that returns a plausible object and no error. It was the reply eval that caught it, not a stack trace.

The `fetch` wrapper reads the key per request because `createOpenAICompatible` would otherwise snapshot `process.env` at module load, which is empty during `eve build` and on Vercel. `tokenFactoryModel` also trims the id: `vercel env` stored from stdin keeps a trailing newline, and Token Factory then 404s `chat/completions` for an id that looks correct in the dashboard. Both are one-line defences against a failure that presents as "the model is wrong" rather than "the config is wrong".

### The registry is the argument, not the value

[`agent/lib/models.ts`](../../agent/lib/models.ts) declares four roles, and each spec carries more than an id:

```ts
export type ModelRole = "planner" | "scout" | "classifier" | "judge";

export interface RoleSpec {
  model: string;          // the catalog id serving this role by default
  env: string;            // env var that overrides it
  contextWindow: number;  // context window of the default, for defineAgent
  rationale: string;      // what this job demands, and why this model answers it
}
```

**The `rationale` field is not a comment.** `modelRouting()` returns it alongside the live id; [`app/observe/page.tsx`](../../app/observe/page.tsx) renders it as a column beside each role, and the [observability rail](../../app/_components/observability-rail.tsx) on the home page carries it as the hover title on each role. A justification that ships next to the choice is a justification someone will notice has gone stale.

The four jobs demand different things, and the registry says so. The `planner` is Venus's voice and her orchestration — a small share of a plan's cost and all of what the couple reads, so it is held constant until an eval can measure prose quality. The `scout` specialists run long tool loops that re-send a growing transcript, which makes input price and context length the dominant terms. The `classifier` makes one structured-output call per reply on untrusted email from the open internet. The `judge` grades the others.

**The judge is pinned away from every other role on purpose.** Grading with the model under test moves the bar along with it, and every comparison you run afterwards measures nothing. It is the one role whose id should change least often and for the fewest reasons.

### One door in, one door out

```ts
export function modelIdFor(role: ModelRole): string {
  const spec = MODEL_ROLES[role];
  const id = (process.env[spec.env] ?? "").trim() || spec.model;
  assertKnownModel(id, spec.env);
  return id;
}
```

Everything else is built on this: `modelFor(role)` wraps it into a `LanguageModel`, `contextWindowFor(role)` feeds `defineAgent`, `modelRouting()` reports it. The env override wins, so a swap really is one line — and because the read happens at call time rather than at module load, an override set in the deployment environment takes effect without a rebuild. `modelRouting()` returns an `overridden` flag alongside the id, so a role running on something other than its declared default says so on the page rather than in someone's shell history.

### The price table is the allowlist

```ts
const KNOWN = new Set(Object.keys(TOKEN_FACTORY_PRICING));

function assertKnownModel(id: string, envVar: string): void {
  if (KNOWN.has(id) || process.env.NEBIUS_ALLOW_UNKNOWN_MODEL === "1") return;
  // ...suggest near matches, then throw
}
```

**Why stop the process over a typo?** Because the alternative is the anti-pattern: a mistyped id falls through to a default and the run completes. Sentinel's blueprint carries the same guard with the reason attached — a silent fallback means *you could benchmark the wrong model without noticing*. That is worse in a repository whose every published number is attributed to a named model, because the attribution becomes quietly false while the dashboard stays green.

The snapshot is the right allowlist because it is the same table cost accounting reads. An id that is not in it either is a typo or means the table is stale — and the error names both fixes plus the escape hatch, which reports cost as `$0` and says so.

### Two swaps the registry refused

The classifier sweep ran one pass per candidate over the fifteen labelled replies, on 2026-08-29:

```text
deepseek-ai/DeepSeek-V4-Flash        100% | $0.0020 | 1570ms
Qwen/Qwen3-235B-A22B-Instruct-2507   100% | $0.0023 | 1203ms
zai-org/GLM-5.3-Flash                 93% | $0.0041 | 2633ms
nvidia/Nemotron-3_5-Lightning         80% | $0.0077 | 6613ms
Qwen/Qwen3-30B-A3B-Instruct-2507      73% | $0.0013 | 1851ms
```

Read the bottom two rows before the top two. The candidate with the lowest published per-token rate produced the most expensive run in the field and the slowest median of the five, because price per token is not cost — output volume is. And the cheapest run in the field got the worst score, which on untrusted vendor email means misfiled replies and follow-ups chasing someone who already said yes.

Acting on the top row is what taught the sharper lesson. The switch went in, the same fifteen cases were run again, and the result was the strip in the hook. [`scripts/probe-structured-output.ts`](../../scripts/probe-structured-output.ts) was written to settle whether that was noise — thirty structured-output calls per model, scoring only whether an object came back at all:

```text
Qwen/Qwen3-235B-A22B-Instruct-2507   0/30 failed
deepseek-ai/DeepSeek-V4-Flash        4/30 failed | 2× "the model did not return a response" | 2× "could not parse the response"
```

**An accuracy sweep is structurally blind to this.** A call that never returns an object is not a wrong answer, it is no answer, and averaged into a score it reads as a tie. Correctness of the content and reliability of the shape are different axes, and for a job reading untrusted email the second one decides.

The `scout` role refused a swap too, and its record is less flattering to the registry. The cost argument there was strong — the specialists dominate a plan's spend, the cheaper candidate is cheaper on input and carries four times the context window — and `npm run eval:scout` returned every specialist session failed with not one vendor recorded, against a 46/50 baseline. The decision record for that run is explicit that the model was **not the only cause**: the subagent also carried an `outputSchema` that eve escalates to `OUTPUT_SCHEMA_NOT_FULFILLED`, killing the child session outright. The registry recorded a verdict that a confounded experiment produced. That is worth knowing about your own evidence.

### The harness that learned from being wrong

[`scripts/compare-models.ts`](../../scripts/compare-models.ts) now defaults to three rounds and ranks on the worst one:

```ts
const ROUNDS = Number(process.env.COMPARE_ROUNDS ?? 3);
// …
rows.sort((a, b) => b.worstScore - a.worstScore || b.score - a.score || a.costUsd - b.costUsd);
// …
const cheapestPerfect = rows.filter((r) => r.worstScore === 1).sort((a, b) => a.costUsd - b.costUsd)[0];
```

**Rank on the worst round, not the mean.** A mean hides the bad round; the bad round is the entire signal. Three is the configured default because one pass over fifteen cases can only rule out the clearly worse — it cannot separate two candidates near the top. The script's own closing line tells you to run the sweep again before switching, which is the advice the first sweep did not give.

Two failures are still open. A specialist that swaps into the `scout` role must be re-tested with `npm run eval:scout` before it takes the job, and nothing in the code enforces that — the rationale string asks. And when the classifier was reverted, the eval was not re-run, so the console kept serving the losing model's summary and publicly reported a score for a configuration that had not been deployed for hours. The structural fix — having the console flag any eval summary whose recorded model no longer matches live routing — is recommended and not yet built. Observability that lies is worse than none, and that was the observability lying about itself.

### Where this transfers

The point is not weddings specifically. This pattern transfers to any domain where one system does several jobs with genuinely different demands, and at least one of them produces a structured artifact another step depends on. Insurance claims triage runs a cheap extractor over documents and an expensive reasoner over edge cases. Support-ticket routing classifies at volume and drafts at quality. Clinical or legal document intake needs the schema honoured every time and can tolerate a slower model to get it. Log and alert triage is the same shape with a harder latency budget. In every one of them the cheap-swap argument is *correct about cost* and still loses, and the only thing that catches it is a fixed labelled set, more than one round, and a separately-pinned grader.

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

What this proves is narrow and worth stating precisely: the two harnesses hold the dataset and the prompt constant and vary exactly one line of configuration, so a difference between candidates is attributable to the candidate. They do not prove the incumbent is the best available model — only that the two swaps that were tried were measured, and refused on evidence a single pass would have hidden.

## Going further

- **Give the planner an eval before you touch it.** It is the only role held constant on judgement rather than measurement, and the registry says so in its own rationale. Swapping the voice of the product on a hunch is precisely the move this file exists to prevent.
- **Make the rationale expire.** The strings in `MODEL_ROLES` cite runs by eval name and score, and the date sits in a comment above them. Nothing checks whether the run still exists or still says that, and a rationale that has quietly become fiction is harder to spot than a missing one.
- **Close the loop between the eval record and live routing.** Every eval summary already stores the model it ran on; comparing that against `modelIdFor(role)` at render time would have caught the console reporting a reverted model at the next render instead of hours later.
- **Separate the confounds before you record a verdict.** The `scout` revert bundled a model change with a subagent `outputSchema` change, and the registry recorded a clean-sounding conclusion from an experiment that was not clean.
- **Next: [Delegation — Give the Specialist a Smaller Tool Surface](../02-a-smaller-tool-surface/README.md)** — what happens when one of these roles stops being a model call and becomes a sub-agent with its own session, its own tool surface, and its own way to fail.

## License


Part of the [Venus](../../README.md) repository, which carries no LICENSE file — no reuse rights are granted by default.
