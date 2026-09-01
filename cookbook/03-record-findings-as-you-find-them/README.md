# Durability — Record Findings as You Find Them

> Partial progress survives a truncation. An array at the end of the context does not.

Recipe **03 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → **Durability** → Guards → Governance → Cost → Latency → Observability → Evaluation → Verification

A research specialist works on one category for twenty to forty steps. It searches in batches, opens each vendor's own site, reads the pricing page, decides, and searches again. An obvious design lets the specialist end with a structured array of all its findings. The planner then reads the array from the return value of the specialist.

That design makes every finding depend on the last token. One step that hits the output cap, one provider error, or one cancelled turn removes all of the work. A specialist that researched its category correctly then returns nothing. It returns nothing *silently*: the planner sees an empty result. An empty result from a research specialist looks the same as a category where no good vendor exists.

We measured four configurations. The command `npm run eval:scout` scored each configuration, and the decision log records the results:

```text
scout Qwen3-235B-A22B · outputSchema on the subagent    | 46/50
scout DeepSeek-V4-Flash · outputSchema on the subagent  | 10 of 10 child sessions failed | 0 vendors recorded | 10/22
scout Qwen3-235B-A22B · no outputSchema                 | 33/37
scout Qwen3-235B-A22B · no outputSchema · drive-time guard rewritten | 3-4 vendors per specialist | 0 truncations | 52/53
```

The third row changes two things at the same time: the model changed back, and the schema went away. Thus the row is not a clean attribution, and you must not read it as one. The traces separated the two causes. Every failed child session ended in `OUTPUT_SCHEMA_NOT_FULFILLED`, and several ended before their first search. The fourth row adds a fix that belongs to [Budget the Retrieval](../05-budget-the-retrieval/README.md), not to this recipe.

The score is also the least informative column. Read the `0 vendors recorded` value instead. Ten specialists recorded nothing. An incremental design exists to prevent that state. Here the design could not prevent it, because no finding reached the store.

## What you'll build

```
agent/
  lib/research.ts                     # the store: one hash per category, one field per vendor
  lib/trace.ts                        # the fold: vendorsRecorded, truncations, staleness
  subagents/scout/
    agent.ts                          # the specialist — no outputSchema, deliberately
    tools/record_vendor.ts            # one call per finding, at the moment of verification
  tools/get_research.ts               # the planner's read: findings joined to specialist health
app/api/observe/session/[id]/route.ts # live per-category counts, polled while the fan-out runs
```

## Prerequisites

- Node 24 (`engines` in [`package.json`](../../package.json)) and npm.
- An Upstash Redis REST endpoint — `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or the
  `KV_REST_API_*` pair that the Vercel integration injects. Without the endpoint, the store reports `not_configured`.
- `NEBIUS_API_KEY` for Token Factory, `TAVILY_API_KEY` for the specialist's search tool, and a brief in
  [`evals/data/briefs.json`](../../evals/data/briefs.json) to drive an end-to-end run.
- The declared subagent from the previous recipe — a child session with a tool surface that you selected fully.

## Run it

```bash
npm run test:fold                 # what counts as a recorded vendor — no keys, no credits
npm run run:eve -- boston-boho    # one brief end to end, then dump the store to runs/
```

The first command prints six groups of assertions. Here are two of the groups and the verdict line:

```text
refusals are not failures
  ✓ refusedActions
  ✓ failedActions stays 0
  ✓ vendorsRecorded stays 0

counters survive a summary that predates them
  ✓ refusedActions
  ✓ toolResults
  ✓ toolRuns

trace fold: correct
```

The second command runs the real system. [`scripts/run-eve.ts`](../../scripts/run-eve.ts) sends one brief to the deployment and waits until the fan-out settles. The script then reads the findings with `listAllFindings` and writes a `RunResult` into [`runs/`](../../runs). The file contains only the findings that the specialists recorded during the run. The file never contains a message that a specialist returned.

## Walk-through

### One call per finding

The tool call is the unit of durability. Thus the tool accepts exactly one vendor and states that rule in the description that the model reads — [`record_vendor.ts`](../../agent/subagents/scout/tools/record_vendor.ts):

```ts
description:
  "Record ONE verified vendor you just found. Call this immediately after verifying each " +
  "vendor, before researching the next one — never batch them at the end. Recording the " +
  "same name twice updates that entry rather than duplicating it.",
```

**Name the anti-pattern next to the setting.** A model batches by default: it writes the report first, and then it records the findings afterwards. The [specialist's instructions](../../agent/subagents/scout/instructions.md) state the same rule from the other side — *"Never let a long final write-up substitute for recording as you go."*

The success return is more than an acknowledgement. It carries the stopping rule for the category:

```ts
note:
  total >= 4
    ? "You have enough for this category — finish your report."
    : "Recorded. Research the next vendor.",
```

The tool delivers the number four at the one moment when the model reads with certainty: the result of its last call. A stopping rule in a system prompt competes with thirty steps of transcript. A stopping rule in a tool result does not.

### Where a finding lands

[`research.ts`](../../agent/lib/research.ts) keeps two kinds of key for each wedding. The key `research:<rootSessionId>` holds a set of category slugs. The key `record:<rootSessionId>:<category>` holds a hash from vendor slug to JSON finding. The write is one pipeline, and the pipeline returns the new count, so the tool can send the stopping rule:

```ts
const [, , , total] = await redis([
  ["HSET", k, vendorSlug(finding.name), JSON.stringify(full)],
  ["EXPIRE", k, TTL_SECONDS],
  ["SADD", catsKey(rootSessionId), categorySlug(finding.category)],
  ["HLEN", k],
]);
```

**Idempotency is by vendor name, not by call.** The hash field is a slug of the business name. Thus a model that records a vendor again after a refusal updates the entry in place. A list would grow a second copy on each retry. The eval's check for distinct vendors would then fail on a correct system.

`TTL_SECONDS` is thirty days on both keys. Thirty days lets a couple leave in the middle of a plan and come back. The hash's `EXPIRE` goes in the same pipeline as the write. The set's `EXPIRE` follows in a second call. Thus each write refreshes the lifetime.

One line decides the owner of a finding:

```ts
// Findings belong to the wedding, not to this child session.
const rootSessionId = ctx.session.parent?.rootSessionId ?? ctx.session.id;
```

If you key by the session id of the child, each specialist writes into a private bucket. The planner never reads that bucket. The fallback keeps the tool usable when the tool runs with no parent session.

### Reading it back with a health report

The read is not a `SELECT`. [`get_research.ts`](../../agent/tools/get_research.ts) joins the findings to the live trace. Thus the planner receives a verdict for each specialist, not a count that it must interpret:

```ts
note: stalled
  ? `STALLED — no activity for over ${Math.round(STALL_AFTER_MS / 60000)} minutes. ` +
    "Do not wait for it. Use whatever it already recorded and move on."
  : settled && refused >= 3 && c.vendorsRecorded === 0
    ? "Everything it tried to record was REFUSED — directory sources, addresses that do not " +
      "belong to the vendor, or a missing town. Re-run it and tell it to open each vendor's own site."
    : settled && c.truncations > 0
      ? "CUT OFF mid-run — its findings are incomplete. Re-run this category once with a narrower brief."
      : settled && c.vendorsRecorded === 0
        ? "Recorded nothing. Either re-run this category once, or tell the couple it is still open."
        : undefined,
```

**The order of the branches is important.** A stalled specialist must cause the message "do not wait", even when it also had refusals. The value `settled` means `completed || failed`, not "not running". A child session that waits on an input gate is `waiting`. If the read reports a paused specialist as failed, the planner starts a duplicate specialist.

Each branch also points to a different repair. For a truncated specialist, re-run the category with a narrower brief. For an all-refused specialist, re-run the category with different instructions. For a specialist that recorded nothing, re-run once, or tell the couple that the category is still open. A bare `0` cannot select between those three repairs. That is the full argument for the join of the two stores at read time.

### The counter that makes zero legible

The fold in [`trace.ts`](../../agent/lib/trace.ts) computes `vendorsRecorded` and `truncations` from the durable event stream. No agent reports these counters about itself:

```ts
if (name === "record_vendor" && ok && (!soft || isSuccessStatus(soft))) {
  s.vendorsRecorded = readCount(s.vendorsRecorded) + 1;
}
```

The soft-status check is deliberate. `actionOutcome` reads an unrecognised status as a success, so a new tool does not show as an error on arrival. That default is exactly wrong here. An unknown status inflates the number that `get_research` uses for re-run decisions. A silent gap in the plan is worse than a visible duplicate.

Every counter goes through `readCount`. A summary read back from KV can predate the newest field. Then `undefined + 1` is `NaN`, `NaN` persists as null, and the metric stops permanently.

The truncation signal comes from the model's own finish reason, at both the step and the message — `const truncated = d.finishReason === "length"`. That signal makes "cut off" a fact, not a guess. The event log gets the row `TRUNCATED (hit the output cap)`. `get_research` gets a boolean value that it can route on.

### The return value you do not need

[`agent.ts`](../../agent/subagents/scout/agent.ts) holds the companion lesson. The important line is a comment: `// NO outputSchema, deliberately.`

An `outputSchema` on a long-running child session looks like the safe choice, because it guarantees the shape of the answer. In fact the schema changes a format failure into a session failure. eve raises `OUTPUT_SCHEMA_NOT_FULFILLED`, and the whole child session fails. The failure discards a run that possibly was correct until its final message.

**State the choice, then name the failure it avoids.** The schema is gone because the schema was unnecessary *and* fatal. Findings reach the planner through `record_vendor` and the research store, never through the child session's return value. Thus the guarantee gave no benefit, and its failure mode could remove a full run. The deletion also exposed one field that only traveled in the return value: venue photos. `get_research` now shows that field explicitly as `venue_images`, instead of hidden on one of forty objects.

The record of each vendor stays best-effort. When the store is not reachable, the tool returns `record_failed`. The tool then tells the specialist to keep that vendor in its final report and to continue. That is the one correct use of a closing report: a fallback for a failed write, never the primary channel.

### Where this transfers

The point is not weddings specifically. The pattern applies to each domain where a subagent does long, expensive work that an interruption can stop. In such a domain, a downstream reader must know the difference between "found nothing" and "failed during the work".

Examples: a procurement assistant collects supplier quotes. A security triage agent works a queue of alerts. A citation checker verifies references one at a time. A compliance crawler samples documents against a rule set.

In each example, the unit of work is a finding, and the failure is silent. The loss of a specialist's full run of tool calls has two costs: the credits, and the wrong conclusion from an empty list.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| A category comes back empty and reads as "nothing available" | Findings existed only in a closing message that never completed | Each vendor is written at verification; `get_research` reports `Recorded nothing` for a settled specialist with `vendorsRecorded === 0` |
| A specialist's last step carries `finishReason: "length"` | Output cap hit mid-run; the remaining findings never form | `truncations` increments in the fold; the read returns `CUT OFF mid-run` and only that category is re-run, with a narrower brief |
| A specialist stops emitting events but is still marked `active` | The child is wedged, not slow | `isStalled` reports `stalled` after `STALL_AFTER_MS` (five minutes by default, `SCOUT_STALL_MS`) and the planner is told not to wait for it |
| The child session fails with `OUTPUT_SCHEMA_NOT_FULFILLED` | An `outputSchema` on a sub-agent turns a formatting miss into a dead session | No schema on the scout; the durable store is the contract, and nothing the planner needs depends on the child's reply |
| Every vendor a specialist tried to record was rejected | Guards refused the input — directory sources, addresses belonging to another business, a missing town | `refused >= 3 && vendorsRecorded === 0` returns a different instruction from "recorded nothing": re-run with the brief changed, not with the same brief |
| `record_vendor` returns `record_failed` or `not_configured` | KV unreachable, or no store on this deployment | The tool tells the scout to keep the vendor in its final report and carry on, so a store outage degrades to the old behaviour instead of halting the run |

## Test it

```bash
npm run test:fold      # the fold, against events shaped the way eve actually delivers them
npm run eval:scout     # research quality end to end, against a running deployment
```

`test:fold` asserts the properties that the recording design depends on. A refusal never counts as a recorded vendor. An unrecognised status never inflates the count. A capped search never counts as a search. A summary written before a field existed continues to count and does not become `NaN`. `trace.ts` contained live bugs of exactly that kind under a green suite, because no test called the fold.

`eval:scout` grades each specialist on `vendorsRecorded >= 3` and `truncations === 0` for its category. It then judges the vendors with a model that is pinned away from the model under test. Thus a model swap can move the score, but the swap can never move the criteria.

## Going further

- **Poll the store, not the agent.** `countByCategory` is one `HLEN` per category. That cost is small enough to serve on
  every refresh of [`/api/observe/session/[id]`](../../app/api/observe/session/%5Bid%5D/route.ts). Watch the
  vendors appear one at a time — that view is the fastest way to find a specialist that stopped.
- **Decide what counts as success at the fold, not at the tool.** The tool returns a status string.
  `trace.ts` decides which strings mean that a finding exists. Keep that judgement in one place. Then you
  can add a new guard without a silent change to every number downstream.
- **Give the store a lifetime on purpose.** Thirty days is a decision about the maximum time a user can be
  away in the middle of a task. Each write refreshes the lifetime. Select your lifetime from that question,
  not from a default.
- **Next: Guards.** Durable recording keeps what the specialist wrote, and this includes the wrong things.
  The next recipe in [the arc](../README.md) moves correctness into the tool. There, a rule that the model
  can ignore becomes a refusal that the model cannot ignore.

## License


This recipe is a part of the [Venus](../../README.md) repository. The repository has no LICENSE file, so it grants no reuse rights by default.
