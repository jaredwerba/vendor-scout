# Latency — Spend Round Trips, Not Calls

> Batching is part of the tool signature, because the model can ignore a request in a prompt.

This is recipe **07 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → Governance → Cost → **Latency** → Observability → Evaluation → Verification

A couple watches a scout work. They see a lane that moves and a plan that takes minutes. The search provider seems to be the cause. One traced scout run shows a different cause:

```text
Scout run: 220s wall clock | 166s deciding what to call next | 27s running tools
```

The source does not attribute the remaining seconds. We keep them unattributed and do not add them to the larger number. The important question is which of the two named numbers you can decrease. You cannot control the response time of Tavily. You control the model's turn, and the model makes one turn for each tool call.

The problem increases as the run continues. A tool-calling transcript sends every previous turn again, so step twenty reads all the output of steps one through nineteen again. An extra round trip is not a fixed cost. The cost of an extra round trip increases with the number of round trips you already spent.

[`agent/subagents/scout/instructions.md`](../../agent/subagents/scout/instructions.md) asked for batched searches before [`agent/tools/web_search.ts`](../../agent/tools/web_search.ts) could accept one. That made batching a request, and the model can ignore a request without a signal. The tool now accepts an array.

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
- Recipe 05 (Governance) — the query counter that this tool reserves against before it sends a request.
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

The output shows twenty search calls across seventy-nine steps. The searches are a small part of the run. The output comes from a committed `RunResult` file in [`runs/`](../../runs/). We keep the file in the repository because a benchmark that you cannot read again is only a claim. Run `npm run run:eve -- boston-boho` to make the file again against the live deployment. The command needs the KV credentials in `.env.local` to read the trace. The model keys and the search keys stay on the deployment.

## Walk-through

### Batching lives in the signature, not in the prompt

[`agent/tools/web_search.ts`](../../agent/tools/web_search.ts) makes the plural field the primary field:

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

**A shape that the model must fill is not a rule that the model can ignore.** This design replaced the anti-pattern: a paragraph of instructions that asks for batching, above a tool that accepts one string. The system cannot enforce that arrangement, and the failure is silent. A run that batches and a run that does not batch make the same trace. The second run only makes more of it.

The cap is four. Four is a judgement, not a measured limit. Above four queries, a batch does not cover angles and only guesses. The model then spends real searches from a limited budget on queries it did not think about. The model must decide how many angles the category needs *before* it commits. That decision is the correct research habit.

Both fields are optional. That choice is the second half of the design:

```ts
// Both fields are optional so that neither shape can ever be a SCHEMA
// failure. A schema the model cannot satisfy kills the call — and on a
// subagent, the whole session. An empty batch is recoverable: say so and
// let it try again.
const wanted = (queries?.length ? queries : query ? [query] : []) // …
```

A schema that the model cannot satisfy does not degrade. It stops the call, and on a declared subagent it also stops the child session. The child's `outputSchema` stopped ten of ten scouts in the run that the [engineering log](../../docs/engineering-log.md) records. The commit that made both fields optional guards against that failure. Thus the singular `query` field stays, and its description marks it as the weaker option. A call that has neither field returns `no_query` with an instruction and does not throw an error.

**State the choice, then name the failure that the choice prevents.** A strict schema gives enforcement with a fatal edge case. A tolerant schema with an honest status gives the same enforcement with a recoverable edge case.

### The description is the part the model reads before it decides

```ts
description:
  "Search the web. Pass THREE OR FOUR queries in `queries` and they run at the same time for " +
  "the price of one round trip — different angles on the same category, or different towns in " +
  "the radius. This is the single biggest thing you control about how long the couple waits. " +
  "Use focused queries (vendor type + location + style) and refine based on results.",
```

**Put the latency argument at the point of decision.** The model reads a tool description at the moment it selects a call. The model read the system prompt much earlier, and all the text after it competes for attention. The description names the consequence — *how long the couple waits* — not the mechanism. The consequence gives the model a fact to weigh. The same sentence appears in [`agent/subagents/scout/instructions.md`](../../agent/subagents/scout/instructions.md), so the model sees the same argument in two places.

The tool runs the queries through one `Promise.all`. This call is the point where one round trip covers all the queries:

```ts
const outcomes = await Promise.all(
  ran.map((q, i) => searchOne(q, i, { max_results, include_images, time_range, topic })),
);
```

The tool returns the results grouped by query, so the model can see which angle produced which results. Four sequential calls and one batch of four spend the same number of searches against the budget. Recipe 05 counts the query, not the call. Thus this shape cannot silently multiply the retrieval budget by four.

### A page returned twice is billed for the rest of the run

Overlapping queries are the normal case for a batch, not an accident. [`agent/lib/search-budget.ts`](../../agent/lib/search-budget.ts) suppresses the results that this session already received:

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

**A duplicate result is a recurring cost, not a one-time cost.** The transcript sends the duplicate again on each later model call in the session. You pay for a page from step four again at step five, at step six, and at step twenty. The same mechanism makes round trips expensive, so the two fixes belong in the same recipe. Sentinel, the Nebius compliance blueprint, found the same conclusion and suppresses the chunks that its subagent already saw.

The function suppresses duplicates across the whole batch, not per query. A per-query check misses the most common overlap: two angles on the same category that return the same vendor page. The seen-set keeps the last 400 URLs, so a long session cannot grow the durable state without limit. The oldest entries leave the set first, so the suppression is partial, not total. The tool returns the count only when the count is more than zero:

```ts
...(suppressed > 0 ? { already_seen: suppressed } : {}),
```

**A model does not read a field that is always present.** The tool shows `already_seen` only when it suppressed a result. Thus the field stays a signal that tells the model how much its angles overlap. The field is not a constant in each payload.

### The cheapest round trip is the one you delete

[`agent/subagents/scout/tools/todo.ts`](../../agent/subagents/scout/tools/todo.ts) contains a comment and one call:

```ts
// A scout has one category and a search budget. It used two round trips per
// run keeping a to-do list, and a round trip here costs 10-30 seconds of
// model time — measured at 166s of one scout's 220s spent deciding what to
// call next. The list bought nothing that the budget does not already give.
export default disableTool();
```

**Examine the tool surface for round trips, not only for capability.** Recipe 02 removed the tools that a researcher must not hold. This deletion makes the same cut on a different axis.

A scout has one category and a hard search cap, so a planning tool on it is bookkeeping that the run does not need. Each call to that tool is a full model turn over a transcript that grew since the last turn. `agent.ts` in the same directory contains the other deletion: we removed the `outputSchema`. Thus the closing turn is prose that the model can produce, not a shape that the model can fail to satisfy.

### Not every round trip is worth removing

The scout's instructions give the opposite rule for recording:

```md
4. **Record each vendor the moment you have verified it** — call `record_vendor` *before* you
   start researching the next one. Never batch them up to the end.
```

**Batch the idempotent operations. Do not batch the operations that must survive a truncation.** A search is a read operation, so a batch of four searches loses nothing if the run stops afterwards. A recorded vendor is the only durable proof that a finding existed. Recipe 03 exists because an end-of-context array tied every finding to the last token.

The catering scout in the run above used twenty-three steps and twenty-two tool calls to record three vendors. Each recording was an intentional round trip. Latency work on the write path changes a slow plan into an empty plan.

### The same trick, one level up

[`agent/instructions.md`](../../agent/instructions.md) applies the same reasoning to delegation:

```md
Then **immediately, in that same response**, fan out the research: one **`scout`** call per
category, all in a SINGLE response, **at most five** — venue (always), photography, catering,
florals, music.
```

eve runs the batch concurrently and returns every result before the root continues. Thus the turn costs the time of the slowest scout, not the sum. The output in **Run it** measures that property: five scouts, and `335.8s` of scout time inside a `114.0s` run. The same artifact records the planner at `5 steps` and `102,781ms`, and that duration includes the fan-out that the planner waited for. The planner's lane looks idle because it is idle. The couple waits for catering.

The same instruction file also batches the recovery path. When several venues have no photos, the file tells the planner to put the venues in one call — `queries: ["<venue A> wedding venue", "<venue B> wedding venue"]`. Thus the couple waits one time, not three times.

### What this does not fix

The traced scout's `220` seconds do not fully decompose. The values `166` for decisions and `27` for tools leave a remainder that the source does not attribute. The recipe publishes the remainder as it is and does not round it into either number. No per-step latency histogram exists, because the trace records one duration for each agent. Thus you can only estimate the distribution *within* a scout; you cannot measure it.

The batch cap has a cost: a category that needs eight angles still pays two round trips. `filterSeen` operates per session by design, so five scouts that examine the same towns each pay for the same page. A seen-set that the whole fan-out shares would remove that cost, but the project did not build one. A prefix cache serves most of that repeated input — `90.7%` of all input tokens across 33 agents, per the [engineering log](../../docs/engineering-log.md). The system charges cached reads at the full prompt rate, so you pay for transcript growth in each case. Do not optimise the token count; optimise the wait.

### Where this goes that is not weddings

The point is not only weddings. The pattern applies to each domain where an agent runs a long tool loop over a growing transcript and the tool itself is fast. Examples are security triage that enriches indicators against threat-intel feeds, procurement that examines supplier catalogues, and clinical literature review over a licensed index. Another example is log investigation, where each query takes milliseconds and each decision about the next query does not. In each domain, the arithmetic is the same. The provider's latency is a constant that you pay for and cannot change, and the number of model turns is a variable that you design.

The four moves are also the same in each domain. Make the batch a required shape, not a requested habit. Put the consequence in the tool description, at the point of decision. Suppress the results that the transcript already contains. Delete the tools whose only output is another turn.

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

The test reads each `status:` literal from the tool sources. The test fails on each literal that the taxonomy does not classify. This check keeps the tolerant schema honest. An empty batch returns `no_query`, and `no_query` must stay a refusal. If `no_query` moves into the successes, the system counts a call that searched nothing as a search that found nothing.

The suite does not assert a latency figure. The recipe measures and publishes the wall clock and does not gate on it.

## Going further

- **Measure the decision time before you optimise the tool.** The number that started this recipe is a split of one traced run into decision time and tool time. Without that split, "the agent is slow" points at the component that is easiest to blame.
- **Cap the batch on judgement, then do not change the cap.** Four is not a measured optimum. Four is the point where angle coverage changes into guessing. A higher cap costs little latency and much of a limited search budget. Thus a change to the cap needs an eval, not an intuition.
- **Share the seen-set across a fan-out.** `venus.seen-results` operates per session. That scope is correct for isolation and wasteful for five scouts that examine the same towns. A parent-scoped slot would suppress duplicates across the whole run. The project did not build or measure one.
- **Read the artifacts, not the summary.** [`runs/`](../../runs/) holds one `RunResult` for each system and each brief. [`evals/data/v1-v2.json`](../../evals/data/v1-v2.json) records the round-trip split and names its source file. The record includes the seconds that the split does not attribute.
- **Next:** each number in this recipe came from a trace, and we built the trace before we could trust it. For a period, the trace reported zero scouts while five scouts ran. [Recipe 08 — A Dashboard That Cannot Lie](../08-a-dashboard-that-cannot-lie/README.md) shows how we made that trace honest.

## License


This recipe is part of the [Venus](../../README.md) repository. The repository has no LICENSE file, so it grants no reuse rights by default.
