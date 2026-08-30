# Governance — Budget the Retrieval

> A cap counted in queries, where hitting it is a normal outcome rather than an error.

Recipe **05 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → **Governance** → Cost → Latency → Observability → Evaluation → Verification

A research specialist that keeps refining its query looks like it is working. It emits tool calls, it gets results back, its lane in the observability rail keeps moving. It converges on nothing. Venus's catering scout did exactly that on a traced run, because a guard had asked it for a fact the web cannot answer:

```text
Catering scout: 7 consecutive searches for one drive time | 25 of 25 spent | 1 vendor recorded
```

Nothing about that reads as an error. A cap was in place and the cap did its job — the scout stopped at 25 instead of at infinity, and came back with one caterer. So the cap is not the interesting part of this recipe. Where the counter lives, what unit it counts, which calls are allowed to spend it, and what the model is told when it is gone — those are the parts that decide whether a budget bounds your spend or bounds your results.

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
- A Tavily key in `TAVILY_API_KEY` for live search. Both commands below run without either.
- The Delegation recipe's declared specialist — the cap is per agent because the *session* is per agent.

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

That runs the real fold out of [`agent/lib/trace.ts`](../../agent/lib/trace.ts) against events shaped the way eve delivers them. To exercise the same path with a live provider behind it, set `NEBIUS_API_KEY` and `TAVILY_API_KEY` in `.env.local` and run `npm exec -- eve dev --no-ui --port 3111`.

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

**A per-session slot is what makes the cap per agent.** eve's `defineState` is durable per-session memory, and a subagent never inherits it — each specialist starts fresh. So one module-scope handle, imported by one tool, yields a private counter for every scout in the fan-out without any of them knowing about each other. The specialist gets a research budget; the root gets a larger one for the occasional lookup between conversations, which is why the two constants differ.

The caller does not pass a flag. [`agent/tools/web_search.ts`](../../agent/tools/web_search.ts) reads it off the runtime:

```ts
const budget = countSearches(wanted.length, searchCapFor(Boolean(ctx.session.parent)));
```

**A specialist is anything with a parent.** Deriving the cap from `ctx.session.parent` rather than from a tool argument means a new specialist tier inherits the right budget the day it is declared, and no prompt can talk its way into the larger one.

### The unit of the cap is the query, not the tool call

`web_search` takes an array. The scout is told to send three or four angles at once, because that costs one model round trip instead of four. That shape is the right one for latency — and it is exactly the shape that quietly defeats a naive counter.

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

**Count the query.** Counting tool calls is the anti-pattern here: with a batch size of four, a cap of 25 calls is a cap of 100 searches, and the number you wrote down is off by the batch factor rather than wrong in a way anyone notices. The reservation is taken for the whole batch, in advance, in queries.

**A batch that crosses the line is granted in part rather than refused.** Three of four queries is a better outcome than none, and the model still learns the budget is nearly gone, because `granted < n` comes back to it as `not_run` plus a note naming how many fit. The alternative — reject the batch, keep the budget — spends a round trip to buy nothing.

### Nothing that could never have reached the provider may spend the budget

Order of checks in `execute` is load-bearing, and it did not start out that way — it was corrected after a run with no Tavily key reported its whole budget as spent:

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

The key check comes first, then the empty-batch check, then `countSearches`. Counting first burned all 25 on calls that did nothing and then reported the cap as spent. **A budget is a record of work done, so anything that is not work must not decrement it** — a missing credential, an empty query array, a call refused at the cap itself. None of the three moves the counter: the first two return ahead of it, and `countSearches` writes only when `granted > 0`.

The same rule reaches inside the retry loop. `searchOne` retries with jittered backoff, and only on transient failures:

```ts
if (res.ok) break;
const transient = res.status === 429 || res.status >= 500;
if (!transient) break;
```

**A 429 is the provider asking you to wait; a 4xx is you being wrong.** Retrying the second spends the couple's budget on the same mistake three times. And a retry of the first is not a second search: the whole batch was counted once, before any of the network code ran, so the counter cannot double-charge a request that had to be sent twice.

### `cap_reached` is a refusal, and the difference is measurable

A tool that declines on purpose returns perfectly well. Every surface that reads "did this work" therefore needs a third answer, which is what [`agent/lib/actions.ts`](../../agent/lib/actions.ts) carries:

```ts
export const REFUSED_STATUSES = ["blocked", "cap_reached", "no_query"] as const;
```

**Refused is not a fault, and never a success either.** An outreach round where every send hit the daily cap must not look like one where every send landed; a scout that spent its budget must not look like a scout that failed. Folding refusals into either bucket destroys the one distinction the operator actually needs.

Then there is the count itself. The trace's `tools` map is folded at `actions.requested` — before the tool runs — so it records intent:

```ts
export function toolRuns(
  summary: { tools?: Record<string, number>; toolsRefused?: Record<string, number> } | null | undefined,
  name: string,
): number {
  if (!summary) return 0;
  return Math.max(0, readCount(summary.tools?.[name]) - readCount(summary.toolsRefused?.[name]));
}
```

**Requested is not performed.** Reporting the raw map is how a scout that called `web_search` 30 times against a cap of 25 came to display 30 searches, of which 25 happened. Every surface that reports work done — the rail's `searches` stat, the run collector, and what the planner reads — goes through `toolRuns`. [`agent/tools/get_research.ts`](../../agent/tools/get_research.ts) says so at the call site:

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

**A cap with no instruction attached is a loop.** A model told only "denied" retries, rephrases, and retries again — every one of those a refused call that still costs a round trip and still grows the transcript. The note names the terminal state, forbids the retry, and gives the next action, so the run ends the way a good researcher ends one when the clock runs out. Every successful call also carries `searches_left`, so the model can pace itself rather than discovering the wall by hitting it, and [`agent/subagents/scout/instructions.md`](../../agent/subagents/scout/instructions.md) tells it to read that field and stop at three or four solid vendors *or* at the budget, whichever comes first.

### The guard that turned the budget into a death spiral

The catering scout in the hook was obeying a rule. Every vendor had been required to state its drive time from the couple — and there is no geocoder in this system, so the only tool that could possibly answer was web search, which cannot answer "how long is the drive from A to B" for any pair of towns.

**Asking a model for a fact its tools cannot reach turns a guardrail into a death spiral.** The budget was not the problem; it was the thing that stopped the bleeding at 25 instead of at infinity. The fix moved the requirement to something the tools can actually reach. The town stays required, because it is readable off the vendor's own page. The drive note became optional, and the scout is now told, in the same paragraph as the radius rule, never to search for one:

```md
**Never search for drive times or distances.** Search cannot answer "how long is the drive
from A to B", and trying burns the budget you need for finding vendors — one scout spent
seven straight searches on a single drive time and came back with one vendor.
```

The instruction replaces the search with a judgement the model can make unaided: place the town from what it already knows, or skip the vendor. Two `npm run eval:scout` runs over the same brief:

```text
scout quality 33/37
scout quality 52/53 = 98% | radius judge 100% in all five categories
```

The volume came back and the discipline held — the radius rule did not loosen, it stopped being enforced through a tool that could not enforce it. **A budget makes a bad requirement cheap, not correct.** If your cap keeps being reached, read the last ten queries before you raise it; a spiral and a genuinely hard research problem look identical in the aggregate and nothing alike in the transcript.

### Where this goes that is not weddings

The point is not weddings specifically. This pattern transfers to any domain where an agent researches an open corpus with no ground truth and a metered provider behind it — legal research billed per document retrieved, security triage over a threat-intel feed, procurement sourcing against supplier catalogues, clinical literature review over a licensed index. In each of those the batch shape differs and the cap differs, but the four decisions are the same: keep the counter in durable per-agent state so a fan-out cannot multiply it, count the unit the vendor bills, spend it only on calls that actually leave your process, and make exhaustion a documented terminal state the model knows how to end on.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| A specialist reports more searches than its cap allows | The trace's `tools` map is folded at `actions.requested`, so it counts intent, not work | Read every count through `toolRuns()`, which subtracts `toolsRefused`; `scripts/test-trace-fold.mjs` asserts it |
| Budget fully spent, almost nothing recorded | A required field no available tool can produce, so the model searches for it forever | Make the field optional and forbid searching for it by name in the instructions; check the transcript before raising the cap |
| Budget reports spent on a deployment where search never worked | The counter was decremented before the credential check | Return `not_configured` ahead of `countSearches`; only work decrements |
| Cap set to 25 but roughly 100 searches billed | The cap counts tool calls while the tool accepts a batch | Reserve `wanted.length` queries in one call to `countSearches` |
| One transient 429 charged twice against the budget | The retry sits outside the counted unit | Count the batch once, before the network code; retry beneath it, transient statuses only |
| Model keeps calling search after exhaustion | `cap_reached` returned with no instruction, so the model treats it as a transient denial | Return the terminal state, the used/cap numbers, and the next action in one note |
| A refused call renders in the UI as a success | The chat read `state === "output-available"`, which is only whether the call returned | Route rendered parts through `partOutcome`; `scripts/test-outcomes.mjs` covers both shapes |
| The root agent runs out of searches weeks into a plan | `venus.search` has no per-turn reset, so the root's 40 spans the whole conversation | Known scope. eve's state is durable by design; reset the slot from a lifecycle hook if you want a per-turn budget instead |

## Test it

```bash
npm run test:outcomes
```

It reads every `status:` literal back out of the tool sources and fails on any the taxonomy does not classify, so a renamed status cannot silently move `cap_reached` out of the refused bucket and into the successes:

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

- **Put the cap where the money is, not where the calls are.** Search is metered per query here, so queries are the unit. If your provider bills per document returned, `max_results` belongs in the reservation too — `web_search.ts` sends `search_depth: "advanced"` whenever `time_range` is set, which costs two credits instead of one, and that asymmetry is invisible to a counter that only counts calls.
- **Give every budgeted tool a `_left` field.** Pacing information in the success payload is what lets a model spend its last searches on the gaps rather than on a fourth angle at the same vendor.
- **Dedupe inside the counted unit.** `filterSeen` in [`agent/lib/search-budget.ts`](../../agent/lib/search-budget.ts) drops URLs this session has already been shown, across the whole batch rather than per query, because a tool-calling transcript re-sends every prior turn — a duplicate result is re-billed on every model call for the rest of the run.
- **Next:** the budget bounds retrieval, not spend. [Recipe 06 — Compute the Price, Then Distrust It](../06-compute-the-price-then-distrust-it/README.md) turns token usage into dollars and then explains why the first number it printed was wrong.

## License


Part of the [Venus](../../README.md) repository, which carries no LICENSE file — no reuse rights are granted by default.
