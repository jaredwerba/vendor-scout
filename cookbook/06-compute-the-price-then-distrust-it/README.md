# Cost — Compute the Price, Then Distrust It

> A plausible number that nobody cross-checks looks the same as a correct number.

Recipe **06 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → Governance → **Cost** → Latency → Observability → Evaluation → Verification

Nebius Token Factory returns token counts and no price. eve's `step.completed.usage.costUsd` is undefined on
every step. Thus this project computes each dollar figure that it shows. A computed figure can be wrong while
nothing fails. Two figures were wrong. First, every cost was `$0`. Then, for one day, every cost was plausible.

The report reads one traced plan back from the store and prices it two times. One price is the stored value.
The other price comes from the stored tokens of the plan:

```text
Run: wrun_41M16NZKKB0GJNG65GT0HQ5BGW | agents: 6 | in: 3,938,369 | out: 20,089 | cached: 3,486,160
stored $1.50 | recomputed $0.800
```

The run, the tokens, the model, and the price table are the same. Only the arithmetic changed. The dollar
figures are not the important part. The important part is that the system cannot tell the two figures apart.

## What you'll build

```
agent/lib/
  pricing.generated.ts   # the catalog snapshot: one row per model, dollars per million tokens
  pricing.ts             # priceFor · costFor · agentCost · cacheHitRate · formatUsd
  models.ts              # role → model id, and the guard that stops an unpriceable one
  trace.ts               # step.completed → tokens stored, a cost derived at write time
  report.ts              # fleet statistics, with cost recomputed on read
scripts/
  refresh-pricing.ts     # npm run pricing:refresh — regenerates the snapshot from the catalog
  report.ts              # npm run report — the evidence pack printed below
```

## Prerequisites

- `NEBIUS_API_KEY` — the generator calls the Token Factory catalog endpoint, and the endpoint requires this key.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — the trace store holds the tokens, and the report derives the cost from them.
- Node 24 — `package.json` declares `engines.node: "24.x"`. Run `npm install` at the repository root.
- Complete Recipe 03 (Durability) first. The trace must record the tokens for each agent before the report can recompute the cost.
- Use more than one traced session. A single run cannot show a tail, and the tail is the main lesson.

## Run it

```bash
npm install
npm run report      # every traced session, cost recomputed from stored tokens
```

```text
VENUS — EVIDENCE PACK
36 traced sessions · 116 agent sessions · $20.60 of real inference
──────────────────────────────────────────────────────────────────────────────

2. COST HAS LONG TAILS

   16 runs with real spend
     median   $0.800
     p90      $3.31
     max      $9.36   6 agents, 218 steps
     ratio    11.7× median

   The tail is not the model being expensive — it is an agent that would not stop.
   Which is what the per-session search budgets bound, and why cost is
   reported per agent in the app rather than per plan.
```

(Captured 2026-08-30. Sections 1, 3 and 4 cover reliability, evals, and generations. This recipe omits them.)

Sixteen of the thirty-six traced sessions have spend. [`report.ts`](../../agent/lib/report.ts) drops the other
sessions before it computes the quantiles. A session with no priced step is not a cheap run, and it pulls the
median toward zero if the report keeps it. Read the ratio, not the maximum. A tail that is far above the median
does not show a costly model. It shows an agent that did not stop.

## Walk-through

### The price table is generated, never typed

[`scripts/refresh-pricing.ts`](../../scripts/refresh-pricing.ts) reads `GET /v1/models?verbose=true`. In that
response, `pricing.prompt` and `pricing.completion` are dollars *per token*. The script writes a module with
dollars per million tokens:

```ts
const rows = body.data
  .filter((m) => m.pricing?.prompt)
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((m) => { /* → `"<id>": { in, out, context },` */ });
```

**The anti-pattern is a price table that a person types by hand.** Rates that a person copies from a pricing
page become stale. No test detects the stale rates, because a wrong constant is still a number.
[`pricing.generated.ts`](../../agent/lib/pricing.generated.ts)
shows its generation date on the first line and sorts the rows by model id. Thus a refresh produces a diff that
a reviewer can read, not a reshuffle. The script drops each model that the catalog does not price, and it does
not apply a default rate.

The price table is also the allow-list. [`models.ts`](../../agent/lib/models.ts) refuses to route to an id that is not in the table:

```ts
throw new Error(
  `${envVar}="${id}" is not in the Token Factory catalog snapshot.\n` +
    (near.length ? `  Did you mean: ${near.join(", ")}?\n` : "") +
    "  If the model is new, refresh the snapshot: npm run pricing:refresh\n" +
    "  To proceed anyway (cost will report as $0): NEBIUS_ALLOW_UNKNOWN_MODEL=1",
);
```

**State the choice, then name the failure that the choice prevents.** The choice is to stop the process on an
unknown id. The failure occurs when an environment variable with a typing error falls back to a different
model. Then the comparison attributes every number to a model that never ran. The override exists, and its
message tells you the cost of the override.

### The model id is not in the field the shape suggests

For a period, every cost was `$0`, and the trace recorded the token counts correctly the full time. eve reports
the running model as `RuntimeIdentity.modelId`. The fold read `runtime.model`, and that field is not present.
Thus `s.model` stayed null, `priceFor` returned null, and `costFor` returned `0`. In
[`trace.ts`](../../agent/lib/trace.ts):

```ts
// RuntimeIdentity.modelId is the authoritative field; the older
// `runtime.model` shape is kept as a fallback. Getting this wrong is
// invisible: the trace still records tokens, but every cost is $0.
const m = d?.runtime?.modelId ?? d?.runtime?.model;
```

**A metric that stays at zero looks like a quiet system, not a broken system.** Each other counter on the same
summary — steps, tools, tokens — continued to move. Thus the dashboard looked healthy. No alert monitors a
gauge that does not move.

The same symptom has a second cause, in [`nebius.ts`](../../agent/lib/nebius.ts). Streaming is the default
path for a chat agent. On the OpenAI-compatible wire, the final chunk holds the usage only when you request it.
Without `includeUsage: true`, the tokens do not arrive. Then the cost is zero for a different reason, but the
symptom looks the same.

### The id you receive is not the id the table keys on

eve adds the prefix of the provider to the model id. This record comes from the trace store, for the run at
the top of this recipe:

```text
root  token-factory/Qwen/Qwen3-235B-A22B-Instruct-2507  in=603754 | out=8777 | cached=536672
```

The catalog, and thus the price table, holds that model as `Qwen/Qwen3-235B-A22B-Instruct-2507`. A plain map
lookup does not match, and a missed lookup gives a zero. [`pricing.ts`](../../agent/lib/pricing.ts) removes
prefixes one at a time:

```ts
let id = (modelId ?? "").trim().replace(/^dynamic:/, "");
if (!id) return null;
for (let i = 0; i < 3; i += 1) {
  const hit = TOKEN_FACTORY_PRICING[id];
  if (hit) return hit;
  const cut = id.indexOf("/");
  if (cut === -1) return null;
  id = id.slice(cut + 1);
}
```

The limit of three permits the id as given plus two removals. That is sufficient for a provider prefix in
front of a `vendor/model` catalog id. The limit also gives a hard stop on a malformed id. The function returns
`null`, never a guessed rate. An invented price is worse than a gap, because a gap is visible.

### `prompt_tokens` already contains `cached_tokens`

After the id fix, the numbers became plausible, and that state is worse than zero. Token Factory serves a
repeated prompt prefix from the cache. On the OpenAI-compatible wire, `prompt_tokens` is the *whole* prompt,
and `prompt_tokens_details.cached_tokens` is a subset of it. `costFor` added the two values. Now it bills the
input once:

```ts
const input = Number(usage.inputTokens ?? 0) || 0;
const output = Number(usage.outputTokens ?? 0) || 0;
return (input * price.in + output * price.out) / 1e6;
```

The comment above that function records the check that settled the question: a 2,024-token prompt reported
2,016 cached tokens. This was not a ratio and not a sample. It was one request, read from the wire. That is the
cross-check that the tagline describes, and the check took one minute. The size of the effect depends on the
cache:

```text
Run wrun_41M16NZKKB0GJNG65GT0HQ5BGW | in: 3,938,369 | cached: 3,486,160 | hit: 88.5%
Recorded 2026-08-29 | 90.7% of all input tokens across 33 agents
```

**The hit rate is the number that explains the bill, so the app shows it.** A specialist sends a transcript
that grows at every step, and a prefix cache serves exactly that shape. Thus the cache serves almost all billed
input. This project charges cached reads at the full prompt rate, and that choice is deliberate. If Nebius
discounts cached reads, this estimate is too high. A cost report must estimate high, not low.

### Recompute on read, so the history is corrected too

If the system computes a cost only at write time, that cost stays wrong permanently. `agentCost` prefers the
recomputed cost. It uses the stored figure only when the price table does not hold the model of the summary:

```ts
const recomputed = costFor(summary?.model, summary ?? {});
return recomputed > 0 ? recomputed : Number(summary?.costUsd) || 0;
```

**Use one function, or every surface disagrees.** In the past, five call sites each wrote this arithmetic.
Three call sites used one method, and two call sites used the raw `costUsd`. Thus the observability rail and
the mobile strip could show two different dollar figures for the same run. Today
[`report.ts`](../../agent/lib/report.ts) and
[`observability-rail.tsx`](../../app/_components/observability-rail.tsx) both call `agentCost`.

The last trap is the formatter. Two decimal places is the usual choice, but that choice shows a real
classifier call as `$0.00`. `npm run models:compare` measures such a call at a fraction of a cent. The `$0.00`
output shows the same defect that the rest of this recipe describes. `formatUsd` increases the precision when
the amount decreases.

### What the number still is not

Nobody has checked a figure here against an invoice. Each figure is a list price from a dated price table,
multiplied by measured tokens. A comment in [`models.ts`](../../agent/lib/models.ts) asserts that the planner
is approximately 15% of a plan and the specialists approximately 80%. No script here measures the cost share
for each role.

Also, `npm run report` does not print the fleet `cacheHitRate` that [`report.ts`](../../agent/lib/report.ts)
computes. That figure reaches a reader only through the `/compare` dashboard, from a recorded figure
in [`v1-v2.json`](../../evals/data/v1-v2.json). This recipe lists those gaps and does not close them, because a
cost recipe that ends in confidence has missed its own lesson.

### Taking it somewhere that is not a wedding

The point is not weddings. This pattern transfers to each domain where the provider meters the usage and
leaves the money calculation to you. Examples: a claims pipeline priced per document, a legal-research
assistant billed to a matter number, and a support-triage bot charged to a team. Another example is a batch
extraction job over a supplier catalog. In each of them, the vendor returns counts, a person multiplies, and
the product appears on a slide.

Generate the price table, and do not type it. Derive the cost on read, and do not freeze it at write time.
Compare one real call against the wire before a person quotes a total. The domain changes what the tokens buy.
The domain does not change one fact: an unverified figure and a correct figure look the same.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| Every cost is `$0`; token counts look right | The model id was read from a field the runtime does not populate, so `priceFor` never matched | Read `RuntimeIdentity.modelId`, keep the older shape as a fallback ([`trace.ts`](../../agent/lib/trace.ts)) |
| Every cost is `$0` and tokens are `0` too | Streamed turns omit usage unless it is requested | `includeUsage: true` on the provider ([`nebius.ts`](../../agent/lib/nebius.ts)) |
| A known model still prices at zero | The trace carries a provider-prefixed id; the table keys on the bare catalog id | `priceFor` peels prefixes and returns `null` rather than guessing |
| Every cost is plausible and the invoice disagrees | `prompt_tokens` includes `cached_tokens`; both were billed | Bill `inputTokens` once — it is already the whole prompt |
| A newly routed model reports no spend | Its id is absent from the catalog snapshot | `modelIdFor` throws with nearest matches; `npm run pricing:refresh`, or `NEBIUS_ALLOW_UNKNOWN_MODEL=1` knowing cost will read `$0` |
| Fixing the rate leaves old sessions wrong | Cost was computed once, at write time, and stored | `agentCost` recomputes from stored tokens on every read |
| Two surfaces show different dollars for one run | Each call site did its own arithmetic | One exported function, called by the report and the live rail alike |
| A real call renders as `$0.00` | Two-decimal formatting on sub-cent amounts | `formatUsd` widens precision below a cent |

## Test it

```bash
npm run verify   # typecheck · next build · eve build · test:guards · test:outcomes · test:fold · cookbook:check
```

That suite makes sure of the *shape* of the pipeline, not the price. `test:fold` drives
[`trace.ts`](../../agent/lib/trace.ts) with events in the form that eve delivers. Thus the fold does not count
a refusal as a failure, and it does not count a capped search as a search. No case in the suite asserts a
dollar amount, and no unit test covers `costFor`.

Two checks replace such a test. First, the report derives the cost and does not store it. `npm run report`
reprices every session in the store against the current price table on each run. Thus a wrong rate moves the
median of the whole fleet and does not hide in one row. Second, a person compared one call against the response
of the provider.

## Going further

- **Refresh the price table before you trust a comparison.** `npm run pricing:refresh` rewrites
  [`pricing.generated.ts`](../../agent/lib/pricing.generated.ts) from the live catalog and adds the date. A
  price table that is one month old, plus a newly routed model, can make a fair benchmark unfair.
- **Split the cached rate in the price table, not at the call sites.** `ModelPrice` holds one input rate
  today, because Token Factory charges cached reads at the prompt rate. If that changes, add one field to one
  type, and every surface stays correct. A conditional at each call site caused the earlier five-way
  disagreement.
- **Measure the cost for each role before you compare models.** The 15%/80% split between the planner and the
  specialists supports every model swap that this project considered. Today that split is only a comment.
  `fleetStats` already reads the model and the tokens for each agent, so one aggregation gives the number.
- **Read the record that this recipe comes from.** [`decisions.json`](../../evals/data/decisions.json) and the
  generated [engineering log](../../docs/engineering-log.md) hold both faults with dates, commits, and run
  ids. The record also holds the figures from before the fix. The record keeps those figures in their original
  form, without a later correction. The date on each entry is the marker.
- **Next: [Latency — Spend Round Trips, Not Calls](../07-spend-round-trips-not-calls/).** Cost and wall clock
  come from the same source: the round trip. The next recipe uses the same traced runs and finds where the
  seconds went.

## License


This recipe is part of the [Venus](../../README.md) repository. The repository has no LICENSE file, and thus it grants no reuse rights by default.
