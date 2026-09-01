# Governance — Budget the Retrieval

> The cap counts queries, and a run that reaches the cap is a normal outcome, not an error.

Recipe **05 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → **Governance** → Cost → Latency → Observability → Evaluation → Verification

A scout that refines its query again and again appears to make progress. It emits tool calls, it gets results, and its lane in the observability rail moves. But it finds nothing. The catering scout of Venus did this on a traced run. A guard asked the scout for a fact that the web cannot supply. The decision record reads:

```text
Catering scout: 7 consecutive searches for one drive time | 25 of 25 spent | 1 vendor recorded
```

That record does not show an error. The cap operated correctly: the scout stopped at 25 searches and recorded one caterer. Without the cap, the scout does not stop. Thus the cap itself is not the important part of this recipe. Four decisions are important: where the counter lives, which unit it counts, which calls spend it, and what the model reads at exhaustion. These decisions control whether a budget limits your spend or limits your results.

## What you'll build

```
agent/
  lib/
    search-budget.ts               # the counter: reserve n, report what was granted
    actions.ts                     # the taxonomy: cap_reached is a refusal, not a fault
    trace.ts                       # the fold: requested minus refused = performed
  tools/
    web_search.ts                  # Tavily batch search, budgeted before it dials out
    get_research.ts                # what the planner is told each specialist did
  subagents/
    scout/
      agent.ts                     # no token gate — the search budget is the limit
      instructions.md              # what to do when searches_left reaches zero
      tools/web_search.ts          # re-export: one implementation, one counter
scripts/
  test-trace-fold.mjs              # a search refused at the cap is not a search
  test-outcomes.mjs                # every status a tool can return is classified
```

## Prerequisites

- Node 24 (`engines` in [`package.json`](../../package.json)).
- An `eve` install with `defineState` and declared subagents — `^0.24.4` here.
- A Nebius Token Factory key in `NEBIUS_API_KEY` to run the live agent.
- A Tavily key in `TAVILY_API_KEY` for live search. The two commands below run without either key.
- The declared scout from the Delegation recipe — the cap is per agent because the *session* is per agent.

## Run it

```bash
git clone https://github.com/jaredwerba/vendor-scout.git
cd vendor-scout
npm install
npm run test:fold
```

```text
refusals are not failures
  ✓ refusedActions
  ✓ failedActions stays 0
  ✓ vendorsRecorded stays 0

a search refused at the cap is not a search
  ✓ web_search calls requested
  ✓ searches actually performed

…

counters survive a summary that predates them
  ✓ refusedActions
  ✓ toolResults
  ✓ toolRuns

trace fold: correct
```

The command runs the real fold from [`agent/lib/trace.ts`](../../agent/lib/trace.ts) against events in the shape that eve delivers. To test the same path with a live provider, set `NEBIUS_API_KEY` and `TAVILY_API_KEY` in `.env.local`. Then run `npm exec -- eve dev --no-ui --port 3111`.

## Walk-through

### The counter is durable, and it never crosses the agent boundary

[`agent/lib/search-budget.ts`](../../agent/lib/search-budget.ts) is a constant pair, a state slot, and one arithmetic function:

```ts
export const SPECIALIST_SEARCH_CAP = 25;
export const ROOT_SEARCH_CAP = 40;

const searches = defineState("venus.search", () => ({ count: 0 }));

export function searchCapFor(isSpecialist: boolean): number {
  return isSpecialist ? SPECIALIST_SEARCH_CAP : ROOT_SEARCH_CAP;
}
```

**A per-session slot makes the cap per agent.** eve's `defineState` gives durable memory per session, and each subagent session gets its own slot. Thus each scout starts with a fresh counter, private to it, and the scouts do not know about each other. One module-scope handle, imported by one tool, supplies that counter for every scout in the fan-out. The scout gets a research budget. The root agent gets a larger budget for occasional lookups between conversations, and this is why the two constants differ.

The caller does not pass a flag. [`agent/tools/web_search.ts`](../../agent/tools/web_search.ts) reads the tier from the runtime:

```ts
const budget = countSearches(wanted.length, searchCapFor(Boolean(ctx.session.parent)));
```

**A scout is any agent with a parent.** The tool derives the cap from `ctx.session.parent`, not from a tool argument. Thus a new scout tier inherits the correct budget on the day of its declaration. Also, no prompt can make the tool grant the larger budget.

### The unit of the cap is the query, not the tool call

`web_search` accepts an array. The instructions tell the scout to send three or four query angles at one time. This costs one model round trip instead of four. That shape is correct for latency. But the same shape defeats a naive counter.

```ts
export function countSearches(
  n: number,
  cap: number,
): { granted: number; used: number; cap: number; exhausted: boolean } {
  const current = searches.get().count;
  const granted = Math.max(0, Math.min(n, cap - current));
  if (granted > 0) searches.update(() => ({ count: current + granted }));
  return { granted, used: current + granted, cap, exhausted: granted === 0 };
}
```

**Count the query.** Do not count tool calls. With a batch size of four, a cap of 25 calls permits 100 searches. The recorded number is then wrong by the batch factor, and nobody notices. The tool reserves the whole batch in advance, in queries.

**A batch that crosses the cap gets a partial grant, not a refusal.** Three queries out of four is a better outcome than zero. The model also learns that the budget is almost gone: `granted < n` returns as `not_run` plus a note that names how many queries fit. The alternative is to reject the batch and keep the budget. That alternative spends a round trip and gains nothing.

### Nothing that could never have reached the provider may spend the budget

The order of the checks in `execute` is important, and it was not correct at first. A run with no Tavily key reported its whole budget as spent. That run caused the correction:

```ts
if (!TAVILY_KEY) {
  return {
    status: "not_configured",
    note:
      "Web search is not configured on this deployment (missing TAVILY_API_KEY). " +
      "Tell the couple you currently can't search the web, and answer only from " +
      "pages you can fetch directly or information they provide. Do not guess.",
  };
}
```

The key check comes first, then the empty-batch check, then `countSearches`. When the count came first, calls that did no work spent all 25 queries, and the tool reported the cap as spent. **A budget is a record of work done, so an event that is not work must not decrement it.** Examples: a missing credential, an empty query array, and a call refused at the cap. None of the three moves the counter. The first two return before the count, and `countSearches` writes only when `granted > 0`.

The same rule reaches inside the retry loop. `searchOne` retries with jittered backoff, and only on transient failures:

```ts
if (res.ok) break;
const transient = res.status === 429 || res.status >= 500;
if (!transient) break;
```

**A 429 means that the provider tells you to wait. A different 4xx means that your request is wrong.** A retry of a wrong request spends the couple's budget on the same mistake three times. A retry of a 429 is not a second search. The tool counts the whole batch one time, before the network code runs. Thus the counter cannot charge twice for a request that the tool sent twice.

### `cap_reached` is a refusal, and the difference is measurable

A tool that refuses on purpose returns without an error. Thus every surface that asks "did this work" needs a third answer. [`agent/lib/actions.ts`](../../agent/lib/actions.ts) supplies that answer:

```ts
export const REFUSED_STATUSES = ["blocked", "cap_reached", "no_query"] as const;
```

**A refusal is not a fault, and it is not a success.** An outreach round where every send reached the daily cap must not look like a round where every send arrived. A scout that spent its budget must not look like a scout that failed. A fold of refusals into either bucket destroys the one distinction that the operator needs.

The count itself also needs care. The fold reads the trace's `tools` map at `actions.requested`, before the tool runs, so the map records intent:

```ts
export function toolRuns(
  summary: { tools?: Record<string, number>; toolsRefused?: Record<string, number> } | null | undefined,
  name: string,
): number {
  if (!summary) return 0;
  return Math.max(0, readCount(summary.tools?.[name]) - readCount(summary.toolsRefused?.[name]));
}
```

**A requested call is not a performed call.** One scout called `web_search` 30 times against a cap of 25, and the raw map displayed 30 searches. Only 25 searches occurred. Thus every surface that reports work done goes through `toolRuns`: the rail's `searches` stat, the run collector, and the data that the root agent reads. [`agent/tools/get_research.ts`](../../agent/tools/get_research.ts) states this at the call site:

```ts
// Searches performed, not calls requested: a call refused at the
// budget cap never reached Tavily.
searches: toolRuns(c, "web_search"),
```

### Tell the model the budget is gone, and tell it what to do instead

Exhaustion returns a payload, not an exception:

```ts
return {
  status: "cap_reached",
  used: budget.used,
  cap: budget.cap,
  note:
    `Search budget for this agent is spent (${budget.cap} searches). Do NOT search again. ` +
    "Finish with what you already found: record or report every vendor you verified, " +
    "and say plainly which parts you could not cover.",
};
```

**A cap without an attached instruction causes a loop.** A model that reads only "denied" retries, rephrases, and retries again. Each retry is a refused call that costs a round trip and grows the transcript. The note names the terminal state, forbids the retry, and gives the next action. Thus the run ends in an orderly way.

Every successful call also carries `searches_left`, so the model can pace its remaining searches. [`agent/subagents/scout/instructions.md`](../../agent/subagents/scout/instructions.md) tells the scout to read that field. The scout stops at three or four solid vendors *or* at the budget, whichever comes first.

### The guard that turned the budget into a death spiral

The catering scout in the opening example obeyed a rule. A guard required each vendor record to state the drive time from the couple. The system has no geocoder, so the only candidate tool was web search. Web search cannot answer "how long is the drive from A to B" for any pair of towns.

**A guard that demands a fact outside the reach of the tools causes an endless retry loop.** The budget was not the problem: it stopped the loss at 25 searches, and without it, the loop does not stop. The fix moved the requirement to a fact that the tools can reach. The town stays required, because the scout can read it from the vendor's own page. The drive note became optional, and the instructions now tell the scout, in the same paragraph as the radius rule, never to search for one:

```md
**Never search for drive times or distances.** Search cannot answer "how long is the drive
from A to B", and trying burns the budget you need for finding vendors — one scout spent
seven straight searches on a single drive time and came back with one vendor.
```

The instruction replaces the search with a judgement that the model can make without tools. The model places the town from its own knowledge, or it skips the vendor. `npm run eval:scout` scored the rewritten guard over the same brief, and the decision record reads:

```text
scout quality: 52/53 (98%) | radius judge: 100% in all five categories
```

On the day of the measurement, the scout recorded full results again, and it obeyed the rule. The radius rule did not become weaker. It only stopped its dependence on a tool that could not enforce it. The rule later lost its effect, and it returned at the write boundary as straight-line arithmetic. That follow-up belongs to [Refuse in the Tool](../04-refuse-in-the-tool/README.md). The lesson that stands here is the lesson of the endless loop: the guard that replaced the prose computes the location, and it never searches.

**A budget makes a bad requirement cheap, not correct.** When a scout reaches the cap again and again, read the last ten queries before you increase the cap. An endless retry loop and a genuinely hard research problem look identical in the aggregate. In the transcript, they look fully different.

### Where this goes that is not weddings

The point is not weddings. This pattern applies to each domain where an agent researches an open corpus with no ground truth through a metered provider. Examples: legal research billed per retrieved document, security triage over a threat feed, procurement against supplier catalogues, and clinical literature review over a licensed index.

In each domain the batch shape and the cap differ, but the four decisions stay the same. Keep the counter in durable per-agent state, so that a fan-out cannot multiply it. Count the unit that the provider bills. Spend the budget only on calls that leave your process. Make exhaustion a documented terminal state, and tell the model how to end on it.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| A specialist reports more searches than its cap allows | The trace's `tools` map is folded at `actions.requested`, so it counts intent, not work | Read every count through `toolRuns()`, which subtracts `toolsRefused`; `scripts/test-trace-fold.mjs` asserts it |
| Budget fully spent, almost nothing recorded | A required field no available tool can produce, so the model searches for it forever | Make the field optional and forbid searching for it by name in the instructions; check the transcript before raising the cap |
| Budget reports spent on a deployment where search never worked | The counter was decremented before the credential check | Return `not_configured` ahead of `countSearches`; only work decrements |
| Cap set to 25 but up to 100 queries run (25 × 4) | The cap counts tool calls while the tool accepts a batch | Reserve `wanted.length` queries in one call to `countSearches` |
| One transient 429 charged twice against the budget | The retry sits outside the counted unit | Count the batch once, before the network code; retry beneath it, transient statuses only |
| Model keeps calling search after exhaustion | `cap_reached` returned with no instruction, so the model treats it as a transient denial | Return the terminal state, the used/cap numbers, and the next action in one note |
| A refused call renders in the UI as a success | The chat read `state === "output-available"`, which is only whether the call returned | Route rendered parts through `partOutcome`; `scripts/test-outcomes.mjs` covers both shapes |
| The root agent runs out of searches weeks into a plan | `venus.search` has no per-turn reset, so the root's 40 spans the whole conversation | Known scope. eve's state is durable by design; reset the slot from a lifecycle hook if you want a per-turn budget instead |

## Test it

```bash
npm run test:outcomes
```

The test reads every `status:` literal from the tool sources. It fails on each literal that the taxonomy does not classify. Thus a renamed status cannot move `cap_reached` from the refused bucket into the successes without a test failure:

```text
22 status literals across 26 sources
  ✓ blocked                    -> refused
  ✓ booked                     -> success
  ✓ cancelled                  -> success
  ✓ cap_reached                -> refused
  …
outcome taxonomy: complete and correct
```

## Going further

- **Put the cap on the billed unit, not on the calls.** The provider meters search here per query, so the query is the unit. When your provider bills per returned document, put `max_results` in the reservation too. `web_search.ts` sends `search_depth: "advanced"` when `time_range` is set, and that setting costs two credits instead of one. A counter that counts only calls cannot see that difference.
- **Give every budgeted tool a `_left` field.** Pacing data in the success payload lets a model spend its last searches on the gaps, not on a fourth angle at the same vendor.
- **Dedupe inside the counted unit.** `filterSeen` in [`agent/lib/search-budget.ts`](../../agent/lib/search-budget.ts) drops the URLs that this session already saw. It operates across the whole batch, not per query. A tool-calling transcript re-sends every prior turn, so a duplicate result costs tokens again on every model call for the rest of the run.
- **Next:** the budget limits retrieval, not spend. [Recipe 06 — Compute the Price, Then Distrust It](../06-compute-the-price-then-distrust-it/README.md) turns token usage into dollars, and then it explains why its first printed number was wrong.

## License


This recipe is part of the [Venus](../../README.md) repository. The repository has no LICENSE file, so it grants no reuse rights by default.
