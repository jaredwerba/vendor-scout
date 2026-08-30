# Cost — Compute the Price, Then Distrust It

> A plausible number nobody cross-checks is indistinguishable from a correct one.

Recipe **06 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → Governance → **Cost** → Latency → Observability → Evaluation → Verification

Nebius Token Factory returns token counts and no price. eve's `step.completed.usage.costUsd` arrives undefined
on every step, so every dollar figure this project has ever shown is a number it computed itself — which makes
every one of them a number that can be wrong while nothing fails. Two of them were. First every cost was `$0`.
Then, for a day, every cost was plausible.

One traced plan, read back out of the store and priced twice — once as it was stored, once from its own tokens:

```text
Run: wrun_41M16NZKKB0GJNG65GT0HQ5BGW | agents: 6 | in: 3,938,369 | out: 20,089 | cached: 3,486,160
stored $1.50 | recomputed $0.800
```

Same run, same tokens, same model, same price table. Only the arithmetic changed. The dollar figures are not
the interesting part — the interesting part is that nothing in the system could tell the two apart.

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

- `NEBIUS_API_KEY` — the Token Factory catalog endpoint is authenticated, and the generator calls it.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — the trace store holds the tokens that cost is derived from.
- Node 24 — `package.json` declares `engines.node: "24.x"` — and `npm install` at the repo root.
- Recipe 03 (Durability) first: tokens must be recorded per agent before cost can be recomputed from them.
- More than one traced session. A single run cannot show you a tail, and the tail is the whole point.

## Run it

```bash
npm install
npm run report      # every traced session, cost recomputed from stored tokens
```

```text
VENUS — EVIDENCE PACK
32 traced sessions · 102 agent sessions · $19.45 of real inference
──────────────────────────────────────────────────────────────────────────────
2. COST HAS LONG TAILS

   12 runs with real spend
     median   $1.07
     p90      $3.31
     max      $9.21   6 agents, 217 steps
     ratio    8.6× median
```

(Sections 1, 3 and 4 are reliability, evals and generations; elided here.)

Twelve of the thirty-two traced sessions carry spend at all, and [`report.ts`](../../agent/lib/report.ts) drops
the rest before taking quantiles — a session with no priced step is not a cheap run, and leaving it in only drags
the median toward zero. The ratio is the line worth reading, not the max. A tail that far above the median is not
a model being expensive; it is an agent that would not stop.

## Walk-through

### The price table is generated, never typed

[`scripts/refresh-pricing.ts`](../../scripts/refresh-pricing.ts) reads `GET /v1/models?verbose=true`, where
`pricing.prompt` and `pricing.completion` are dollars *per token*, and writes a module of dollars per million:

```ts
const rows = body.data
  .filter((m) => m.pricing?.prompt)
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((m) => { /* → `"<id>": { in, out, context },` */ });
```

**The anti-pattern is a hand-typed price table.** Rates copied off a pricing page go stale silently and no
test notices, because a wrong constant is still a number. [`pricing.generated.ts`](../../agent/lib/pricing.generated.ts)
carries its generation date on the first line and sorts by model id, so a refresh produces a diff a reviewer
can read rather than a reshuffle. Models the catalog will not price are dropped rather than defaulted.

The snapshot is also the allow-list — [`models.ts`](../../agent/lib/models.ts) refuses to route to an id absent from it:

```ts
throw new Error(
  `${envVar}="${id}" is not in the Token Factory catalog snapshot.\n` +
    (near.length ? `  Did you mean: ${near.join(", ")}?\n` : "") +
    "  If the model is new, refresh the snapshot: npm run pricing:refresh\n" +
    "  To proceed anyway (cost will report as $0): NEBIUS_ALLOW_UNKNOWN_MODEL=1",
);
```

**State the choice, then name the failure it avoids.** The choice is to stop the process on an unknown id. The
failure is a typo'd env var falling back to another model, and every number in the comparison being attributed to
a name that never ran. The escape hatch exists, and its own message says what taking it costs you.

### The model id is not in the field the shape suggests

Every cost was `$0` for a stretch, with token counts recorded correctly the whole time. eve reports the running
model as `RuntimeIdentity.modelId`; the fold was reading `runtime.model`, which is not there — so `s.model`
stayed null, `priceFor` returned null, and `costFor` returned `0`. In [`trace.ts`](../../agent/lib/trace.ts):

```ts
// RuntimeIdentity.modelId is the authoritative field; the older
// `runtime.model` shape is kept as a fallback. Getting this wrong is
// invisible: the trace still records tokens, but every cost is $0.
const m = d?.runtime?.modelId ?? d?.runtime?.model;
```

**A metric pinned at zero reads as a quiet system, not a broken one.** Every other counter on the same
summary — steps, tools, tokens — kept moving, which made the dashboard look alive. Nothing alerts on a
gauge that is calm.

The same symptom has a second entrance, in [`nebius.ts`](../../agent/lib/nebius.ts): streaming is the default
path for a chat agent, and on the OpenAI-compatible wire usage rides the final chunk only if you ask for it.
Without `includeUsage: true` the tokens never arrive at all, so cost is zero for a completely different
reason and looks identical.

### The id you receive is not the id the table keys on

eve prefixes the model with the provider it routed through. Read straight out of the trace store for
the run at the top of this recipe:

```text
root  token-factory/Qwen/Qwen3-235B-A22B-Instruct-2507  in=603754 | out=8777 | cached=536672
```

The catalog — and so the price table — knows that model as `Qwen/Qwen3-235B-A22B-Instruct-2507`. A plain map lookup
misses, and a missed lookup is a zero. [`pricing.ts`](../../agent/lib/pricing.ts) peels rather than matching:

```ts
let id = (modelId ?? "").trim().replace(/^dynamic:/, "");
for (let i = 0; i < 3; i += 1) {
  const hit = TOKEN_FACTORY_PRICING[id];
  if (hit) return hit;
  const cut = id.indexOf("/");
  if (cut === -1) return null;
  id = id.slice(cut + 1);
}
```

The bound of three is the id as given plus two peels — enough for a provider prefix in front of a
`vendor/model` catalog id, and a hard stop rather than an unbounded walk over something malformed. It returns
`null`, never a guessed rate. A fabricated price is worse than a gap, because a gap is visible.

### `prompt_tokens` already contains `cached_tokens`

With the id fixed the numbers turned plausible, which is a worse state than zero. Token Factory serves a repeated
prompt prefix from cache, and on the OpenAI-compatible wire `prompt_tokens` is the *whole* prompt while
`prompt_tokens_details.cached_tokens` is a subset of it. `costFor` was adding the two. It now bills it once:

```ts
const input = Number(usage.inputTokens ?? 0) || 0;
const output = Number(usage.outputTokens ?? 0) || 0;
return (input * price.in + output * price.out) / 1e6;
```

The check that settled it is recorded in the comment above that function: a 2,024-token prompt reported 2,016
cached. Not a ratio, not a sample — one request, read off the wire. That is the cross-check the tagline is
about, and it took a minute. How much it mattered depends entirely on the cache:

```text
Run wrun_41M16NZKKB0GJNG65GT0HQ5BGW | in: 3,938,369 | cached: 3,486,160 | hit: 88.5%
Recorded 2026-08-29 | 90.7% of all input tokens across 33 agents
```

**The hit rate is the number that explains the bill, so the app shows it.** A specialist re-sends a growing
transcript at every step, exactly the shape a prefix cache is built for, so almost all billed input is
cache-served. Cached reads are still charged here at the full prompt rate, deliberately: if Nebius discounts them
this over-estimates, and a cost report should err high rather than flatter itself.

### Recompute on read, so the history is corrected too

A cost written once at write time stays wrong forever. `agentCost` prefers the recomputation and keeps the
stored figure only as a fallback for a summary whose model is missing from the table:

```ts
const recomputed = costFor(summary?.model, summary ?? {});
return recomputed > 0 ? recomputed : Number(summary?.costUsd) || 0;
```

**One function, or every surface disagrees.** Five call sites used to spell this arithmetic out — three one way,
two by trusting `costUsd` raw — so the observability rail and the mobile strip could print two different dollar
figures for the same run. Today [`report.ts`](../../agent/lib/report.ts) and
[`observability-rail.tsx`](../../app/_components/observability-rail.tsx) both call `agentCost`.

The last trap is the formatter. Two decimal places is the reflex, and it renders a real classifier call —
measured at fractions of a cent by `npm run models:compare` — as `$0.00`, reproducing pixel for pixel the bug
the rest of this recipe is about. `formatUsd` widens precision as the amount shrinks instead.

### What the number still is not

No figure here has ever been checked against an invoice. Every one is a list price from a dated snapshot
multiplied by measured tokens. The claim in [`models.ts`](../../agent/lib/models.ts) that the planner is roughly
15% of a plan and the specialists roughly 80% is asserted in a comment and measured nowhere — no script here
computes cost share per role. And the fleet `cacheHitRate` that [`report.ts`](../../agent/lib/report.ts) computes
is not printed by `npm run report`; it reaches a reader only through the `/compare` dashboard, from a recorded
figure in [`v1-v2.json`](../../evals/data/v1-v2.json). Those gaps are listed rather than closed, because a cost
recipe that ends in confidence has missed its own lesson.

### Taking it somewhere that is not a wedding

The point is not weddings specifically. This pattern transfers to any domain where the provider meters usage and
leaves the money to you: a claims pipeline priced per document, a legal-research assistant billed back to a matter
number, an internal support-triage bot charged to the team that triggered it, a batch extraction job over a
supplier catalog. In all of them the vendor returns counts, somebody multiplies, and the product ends up on a
slide. Generate the rate table rather than typing it; derive cost on read rather than freezing it at write time;
and compare one real call against the wire before anyone quotes a total. The domain changes what the tokens are
spent on. It does not change that an unverified figure and a correct one look the same.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| Every cost is `$0`; token counts look right | The model id was read from a field the runtime does not populate, so `priceFor` never matched | Read `RuntimeIdentity.modelId`, keep the older shape as a fallback ([`trace.ts`](../../agent/lib/trace.ts)) |
| Every cost is `$0` and tokens are `0` too | Streamed turns omit usage unless it is requested | `includeUsage: true` on the provider ([`nebius.ts`](../../agent/lib/nebius.ts)) |
| A known model still prices at zero | The trace carries a provider-prefixed id; the table keys on the bare catalog id | `priceFor` peels prefixes and returns `null` rather than guessing |
| Cost is plausible but roughly double | `prompt_tokens` includes `cached_tokens`; both were billed | Bill `inputTokens` once — it is already the whole prompt |
| A newly routed model reports no spend | Its id is absent from the catalog snapshot | `modelIdFor` throws with nearest matches; `npm run pricing:refresh`, or `NEBIUS_ALLOW_UNKNOWN_MODEL=1` knowing cost will read `$0` |
| Fixing the rate leaves old sessions wrong | Cost was computed once, at write time, and stored | `agentCost` recomputes from stored tokens on every read |
| Two surfaces show different dollars for one run | Each call site did its own arithmetic | One exported function, called by the report and the live rail alike |
| A real call renders as `$0.00` | Two-decimal formatting on sub-cent amounts | `formatUsd` widens precision below a cent |

## Test it

```bash
npm run verify   # typecheck · next build · eve build · test:guards · test:outcomes · test:fold
```

That suite guarantees the *shape* of the pipeline, not the price: `test:fold` drives
[`trace.ts`](../../agent/lib/trace.ts) with events in the form eve actually delivers them, so a refusal is never
counted as a failure and a capped search is never counted as a search. No case in it asserts a dollar amount,
and there is no unit test over `costFor`. What stands in for one is that cost is derived rather than stored —
`npm run report` reprices every session in the store against the current table on each run, so a wrong rate
moves a median across the whole fleet instead of hiding in one row — and, in the end, one call compared against
the provider's own response.

## Going further

- **Refresh the snapshot before you trust a comparison.** `npm run pricing:refresh` rewrites
  [`pricing.generated.ts`](../../agent/lib/pricing.generated.ts) from the live catalog and stamps it with the
  date. A month-old table plus a newly routed model is enough to make a fair benchmark unfair.
- **Split the cached rate at the table, not at the call sites.** `ModelPrice` carries one input rate today
  because Token Factory charges cached reads at the prompt rate. If that changes, one field on one type keeps
  every surface honest; a conditional at each call site is how the five-way disagreement happened.
- **Measure cost per role before arguing about models.** The 15%/80% split between planner and specialists
  underwrites every swap this project has considered, and it is currently a comment. `fleetStats` already
  reads model and tokens per agent, so the number is one aggregation away.
- **Read the record this was built from.** [`decisions.json`](../../evals/data/decisions.json) and the
  generated [engineering log](../../docs/engineering-log.md) carry both faults with dates, commits and run
  ids — including the stale figures published before the fix, left marked rather than quietly divided.
- **Next: [Latency — Spend Round Trips, Not Calls](../07-spend-round-trips-not-calls/).** Cost and wall clock
  come out of the same place, the round trip. The next recipe takes these same traced runs and asks where the
  seconds went.

## License


Part of the [Venus](../../README.md) repository, which carries no LICENSE file — no reuse rights are granted by default.
