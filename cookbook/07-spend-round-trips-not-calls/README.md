# Latency — Spend Round Trips, Not Calls

> Batching is part of the tool signature, because a request in a prompt is one a model can stop honouring.

Recipe **07 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → Governance → Cost → **Latency** → Observability → Evaluation → Verification

A couple watching a specialist work sees a lane that keeps moving and a plan that takes minutes, and the natural suspect is the search provider. One traced scout run says otherwise:

```text
Scout run: 220s wall clock | 166s deciding what to call next | 27s running tools
```

The remaining seconds are unattributed in the source and are left that way rather than folded into the larger bucket. What matters is which of the two named numbers you can move. Tavily answers in the time Tavily answers in. The model's turn is the part that belongs to you, and there is one of them for every tool call the model decides to make.

It also gets worse as the run goes on. A tool-calling transcript re-sends every prior turn, so step twenty re-reads everything steps one through nineteen produced. An extra round trip is not a fixed cost — it is a cost that grows with how many round trips you have already spent.

[`agent/subagents/scout/instructions.md`](../../agent/subagents/scout/instructions.md) asked for batched searches before [`agent/tools/web_search.ts`](../../agent/tools/web_search.ts) could express one. That made it a request, and a request is something a model can quietly stop honouring. The tool now takes an array.

## What you'll build

```
agent/
  tools/
    web_search.ts                # queries: string[], max 4, one round trip, one Promise.all
  lib/
    search-budget.ts             # counts queries; filterSeen drops URLs already returned
  instructions.md                # every scout dispatched in a SINGLE response
  subagents/
    scout/
      agent.ts                   # no outputSchema — the loop is what costs, not the return
      instructions.md            # batch three or four angles; never search a drive time
      tools/
        web_search.ts            # re-export: one implementation, one seen-set
        todo.ts                  # disabled: two round trips that bought nothing
runs/
  eve-boston-boho.json           # one traced fan-out, committed so it can be re-read
```

## Prerequisites

- Node 24 (`engines` in [`package.json`](../../package.json)).
- An `eve` install with declared subagents and `defineState` — `^0.24.4` here.
- `TAVILY_API_KEY` for live search and `NEBIUS_API_KEY` for the model. The command below needs neither.
- Recipe 05 (Governance) — the query counter this tool reserves against before it dials out.
- More than one traced run, if you want to know whether a change moved anything.

## Run it

```bash
git clone https://github.com/jaredwerba/vendor-scout.git
cd vendor-scout
npm install
node -e '
const r = JSON.parse(require("fs").readFileSync("runs/eve-boston-boho.json", "utf8"));
const spec = r.agents.filter((a) => a.role === "specialist");
for (const a of spec)
  console.log(`${a.label.padEnd(12)} ${String(a.steps).padStart(2)} steps | ${a.searches} web_search calls | ${(a.durationMs / 1000).toFixed(1)}s`);
const sum = spec.reduce((n, a) => n + a.durationMs, 0);
const max = Math.max(...spec.map((a) => a.durationMs));
console.log(`\nspecialist time ${(sum / 1000).toFixed(1)}s | slowest ${(max / 1000).toFixed(1)}s | run ${(r.wallClockMs / 1000).toFixed(1)}s`);
'
```

```text
catering     23 steps | 6 web_search calls | 75.5s
photography  15 steps | 4 web_search calls | 63.0s
music        14 steps | 4 web_search calls | 72.6s
venue        15 steps | 2 web_search calls | 70.1s
florals      12 steps | 4 web_search calls | 54.7s

specialist time 335.8s | slowest 75.5s | run 114.0s
```

Twenty search calls across seventy-nine steps. The searches are not the run. That is a committed `RunResult` out of [`runs/`](../../runs/), kept in the repository on the stated principle that a benchmark you cannot re-read is an assertion. Regenerate it against the live deployment with `npm run run:eve -- boston-boho`, which needs the KV credentials in `.env.local` to read the trace back; the model and search keys live on the deployment it drives.

## Walk-through

### Batching lives in the signature, not in the prompt

[`agent/tools/web_search.ts`](../../agent/tools/web_search.ts) makes the plural the primary field:

```ts
/** Beyond four, a batch is guessing rather than covering angles. */
const MAX_BATCH = 4;
// …
queries: z
  .array(z.string().min(3).max(300))
  .min(1)
  .max(MAX_BATCH)
  .optional()
  .describe(
    `Up to ${MAX_BATCH} search queries, run concurrently. Prefer 3-4 covering different ` +
      "angles over one query at a time — same cost in searches, a quarter of the waiting.",
  ),
```

**A shape the model must fill is not a rule the model can drop.** The anti-pattern is the one this replaced: a paragraph of instruction asking for batching, sitting above a tool that accepts a single string. Nothing about that arrangement is enforceable, and the failure is silent — a run that batches and a run that does not emit the same trace, only more of it.

The cap is four, and four is a judgement rather than a limit anyone measured. Past that a batch stops covering angles and starts guessing, so the model would be spending real searches out of a bounded budget on queries it has not thought about. Deciding how many angles the category needs *before* committing is the research habit you wanted anyway.

Both fields are optional, and that is the second half of the design:

```ts
// Both fields are optional so that neither shape can ever be a SCHEMA
// failure. A schema the model cannot satisfy kills the call — and on a
// subagent, the whole session. An empty batch is recoverable: say so and
// let it try again.
const wanted = (queries?.length ? queries : query ? [query] : []) // …
```

An unsatisfiable schema does not degrade, it terminates — and on a declared subagent it takes the child session with it, which is what the child's `outputSchema` did to ten of ten specialists in the run recorded in the [engineering log](../../docs/engineering-log.md), and what the commit that made both fields optional was guarding against. So the singular `query` stays, marked in its own description as the lesser option, and a call that arrives with neither returns `no_query` with an instruction instead of throwing. **State the choice, then name the failure the choice avoids:** a strict schema buys enforcement at the price of a fatal edge, and a tolerant schema plus an honest status buys the same enforcement with a recoverable one.

### The description is the part the model reads before it decides

```ts
description:
  "Search the web. Pass THREE OR FOUR queries in `queries` and they run at the same time for " +
  "the price of one round trip — different angles on the same category, or different towns in " +
  "the radius. This is the single biggest thing you control about how long the couple waits. " +
  "Use focused queries (vendor type + location + style) and refine based on results.",
```

**Put the latency argument where the decision is made.** A tool description is read at the moment the model chooses a call; the system prompt was read a long transcript ago and is competing with everything since. Naming the consequence — *how long the couple waits* — rather than the mechanic gives the model something to weigh, and that sentence appears verbatim in [`agent/subagents/scout/instructions.md`](../../agent/subagents/scout/instructions.md), so the model meets the same argument in both places.

The queries run through one `Promise.all`, which is where the round trip actually gets amortised:

```ts
const outcomes = await Promise.all(
  ran.map((q, i) => searchOne(q, i, { max_results, include_images, time_range, topic })),
);
```

Results come back grouped by query, so the model can still tell which angle produced what. Four sequential calls and one batch of four spend the same searches against the budget — Recipe 05 counts the query, not the call, precisely so this shape cannot quietly quadruple the retrieval budget.

### A page returned twice is billed for the rest of the run

Overlapping queries are the normal case for a batch, not an accident of one. [`agent/lib/search-budget.ts`](../../agent/lib/search-budget.ts) suppresses what this session has already been shown:

```ts
export function filterSeen<T extends { url?: string }>(results: T[]): {
  fresh: T[];
  suppressed: number;
} {
  const seen = new Set(seenResults.get().urls);
  const fresh = results.filter((r) => {
    const url = (r.url ?? "").trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  // Bounded: a session cannot grow this without limit.
  seenResults.update(() => ({ urls: Array.from(seen).slice(-400) }));
  return { fresh, suppressed: results.length - fresh.length };
}
```

**A duplicate result is not redundant, it is recurring.** The transcript re-sends it on every subsequent model call for the rest of the session, so a page returned at step four is paid for again at step five, and at step six, and at step twenty. The mechanism is the same one that makes round trips expensive, which is why the two fixes belong in the same recipe. Sentinel, the Nebius compliance blueprint, reached the same conclusion and suppresses chunks its sub-agent has already seen.

Dedupe runs across the whole batch rather than per query, because otherwise the most common overlap — two angles on the same category returning the same vendor page — is exactly the one it would miss. The seen-set is bounded at the last 400 URLs so a long session cannot grow durable state without limit — the oldest entries fall out first, which means suppression is best-effort rather than total. The count comes back only when it is non-zero:

```ts
...(suppressed > 0 ? { already_seen: suppressed } : {}),
```

**A field that is always present stops being read.** Surfacing `already_seen` only when something was actually suppressed keeps it as a signal to the model about how much its angles overlap, rather than a constant in every payload.

### The cheapest round trip is the one you delete

[`agent/subagents/scout/tools/todo.ts`](../../agent/subagents/scout/tools/todo.ts) is a comment and one call:

```ts
// A scout has one category and a search budget. It used two round trips per
// run keeping a to-do list, and a round trip here costs 10-30 seconds of
// model time — measured at 166s of one scout's 220s spent deciding what to
// call next. The list bought nothing that the budget does not already give.
export default disableTool();
```

**Audit the tool surface for round trips, not just for capability.** Recipe 02 removed tools a researcher had no business holding; this is the same cut made on a different axis. A planning tool on an agent with one category and a hard search cap is bookkeeping the run does not need, and every call to it is a full model turn over a transcript that has grown since the last one. `agent.ts` in the same directory carries the other deletion — the `outputSchema` is gone, so the closing turn is prose the model can produce rather than a shape it might not.

### Not every round trip is worth removing

The scout's instructions are emphatic in the opposite direction about recording:

```md
4. **Record each vendor the moment you have verified it** — call `record_vendor` *before* you
   start researching the next one. Never batch them up to the end.
```

**Batch what is idempotent; never batch what must survive a truncation.** A search is a read, so folding four into one costs nothing if the run dies afterwards. A recorded vendor is the only durable trace that a finding ever existed, and Recipe 03 exists because an end-of-context array made every finding hostage to the last token. The catering scout in the run above took twenty-three steps and twenty-two tool calls to record three vendors, and every one of those recordings was a round trip spent on purpose. Latency work that touches the write path is how you trade a slow plan for an empty one.

### The same trick, one level up

[`agent/instructions.md`](../../agent/instructions.md) applies the identical reasoning to delegation:

```md
Then **immediately, in that same response**, fan out the research: one **`scout`** call per
category, all in a SINGLE response, **at most five** — venue (always), photography, catering,
florals, music.
```

eve runs the batch concurrently and returns every result before the root continues, so the turn costs the slowest specialist rather than their sum. The strip from **Run it** is that property, measured: five specialists, `335.8s` of specialist time inside a `114.0s` run. The same artifact records the planner at `5 steps` and `102,781ms`, a duration that spans the fan-out it was waiting on. Its lane looks idle because it is; the couple is waiting on catering.

The same instruction file batches the recovery path too. When several venues are missing photos, it tells the planner to put them in one call — `queries: ["<venue A> wedding venue", "<venue B> wedding venue"]` — so the couple waits once rather than three times.

### What this does not fix

The traced scout's `220` seconds do not fully decompose — `166` deciding and `27` running tools leaves a remainder the source does not attribute, and it is published that way rather than rounded into either bucket. No per-step latency histogram exists either — the trace records duration per agent, so the distribution *within* a specialist is inferred rather than measured. The batch cap means a category genuinely needing eight angles still pays two round trips. And `filterSeen` is per session by design, so five specialists researching overlapping towns each pay separately for the same page; a shared seen-set across a fan-out would cut that, and is not built. Most of that re-sent input is served from a prefix cache — `90.7%` of all input tokens across 33 agents, per the [engineering log](../../docs/engineering-log.md) — and cached reads are charged at the full prompt rate here, so growth in the transcript is paid for either way. The token count is not the thing to optimise. The wait is.

### Where this goes that is not weddings

The point is not weddings specifically. This pattern transfers to any domain where an agent runs a long tool loop over a growing transcript and the tool itself is fast: security triage enriching indicators against threat-intel feeds, procurement sourcing across supplier catalogues, clinical literature review over a licensed index, log investigation where each query is milliseconds and each decision about what to query next is not. In every one of them the arithmetic is the same — the provider's latency is a constant you rent, the number of model turns is a variable you design — and the four moves are the same: make the batch a required shape rather than a requested habit, put the consequence in the tool description where the choice is made, suppress what the transcript already carries, and delete the tools whose only output is another turn.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| Model batched on early runs and stopped later | Batching lived in the instructions, where it is a request rather than a constraint | Make the array the primary field on the tool; the shape survives prompt drift |
| A whole subagent session fails with no partial findings | A schema the model cannot satisfy is escalated to `OUTPUT_SCHEMA_NOT_FULFILLED`, which kills the child | Keep both call shapes optional, return a status for the empty case, and carry no `outputSchema` on a tool-calling child |
| Batching four queries quietly quadruples retrieval spend | The budget counts tool calls while the tool accepts an array | Count the query, not the call — `countSearches(wanted.length, …)` reserves the whole batch |
| Cost climbs faster than step count | A page returned twice is re-sent on every later model call for the rest of the session | Suppress already-seen URLs across the whole batch, and report `already_seen` so the overlap is visible |
| Durable state grows without limit over a long session | The seen-set has no bound | `slice(-400)` on the durable slot; the oldest URLs fall out of the set first |
| A batch is refused whole when the budget cannot cover it | All-or-nothing reservation | Grant the part that fits and return `not_run` for the rest; a refused batch spends a round trip and buys nothing |
| The planner's lane looks idle during a fan-out | It is parked while children run; the turn costs the slowest specialist | Read the specialist lanes rather than the root; the observability recipe covers that view |
| Wall clock barely moves after batching lands | Round trips came out of the read path while the write path still batches nothing | Intended. `record_vendor` stays one call per vendor so a truncation cannot erase findings |
| No way to tell whether a latency change helped | Duration is recorded per agent, not per step | Known scope. Compare committed `RunResult` files across runs; the within-agent distribution is not captured |

## Test it

```bash
npm run test:outcomes
```

```text
22 status literals across 26 sources
  ✓ blocked                    -> refused
  ✓ booked                     -> success
  ✓ cancelled                  -> success
  ✓ cap_reached                -> refused
  …
  ✓ no_query                   -> refused
  …
  ✓ {"result":{"output":{"status":"cap_reached"}}}         -> refused
  …
1 runtime-assembled status site(s), all vetted
```

It reads every `status:` literal back out of the tool sources and fails on any the taxonomy does not classify, which is what keeps the tolerant schema honest: an empty batch returns `no_query`, and `no_query` has to stay a refusal rather than drifting into the successes, or a call that searched nothing would be counted as a search that found nothing. Nothing in the suite asserts a latency figure — wall clock here is measured and published, never gated.

## Going further

- **Measure the decision time before you optimise the tool.** The number that started this recipe is a split of one traced run into thinking and doing. Until you have that split, "the agent is slow" points at whichever component is easiest to blame.
- **Cap the batch on judgement, then leave the cap alone.** Four is not an optimum anyone measured; it is where covering angles turns into guessing. Raising it is cheap in latency and expensive in a bounded search budget, so it needs an eval and not an intuition.
- **Share the seen-set across a fan-out.** `venus.seen-results` is per session, which is correct for isolation and wasteful for five specialists working overlapping towns. A parent-scoped slot would suppress across the whole run; nothing here has built or measured one.
- **Read the artifacts rather than the summary.** [`runs/`](../../runs/) holds one `RunResult` per system per brief, and [`evals/data/v1-v2.json`](../../evals/data/v1-v2.json) records the round-trip split with its source file named, including the seconds it does not account for.
- **Next:** every number in this recipe came out of a trace that had to be built before it could be trusted — including a period when it reported zero specialists while five were running. [Recipe 08 — A Dashboard That Cannot Lie](../08-a-dashboard-that-cannot-lie/README.md) is how that trace was made honest.

## License


Part of the [Venus](../../README.md) repository, which carries no LICENSE file — no reuse rights are granted by default.
