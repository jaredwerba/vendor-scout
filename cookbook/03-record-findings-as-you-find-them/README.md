# Durability — Record Findings as You Find Them

> Partial progress survives a truncation; an end-of-context array does not.

Recipe **03 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → **Durability** → Guards → Governance → Cost → Latency → Observability → Evaluation → Verification

A research specialist works one category for twenty to forty steps: search in batches, open each vendor's
own site, read the pricing page, decide, search again. The obvious way to get that work back is to have the
child end with a structured array of everything it found, and to read the array off its return value.

That makes every finding hostage to the last token. One step that hits the output cap, one provider hiccup,
one cancelled turn, and a specialist that researched its category correctly hands back nothing. It hands
back nothing *silently* — the planner sees an empty result, and an empty result from a research agent reads
exactly like a category where nothing good exists.

Three measured configurations, each scored by `npm run eval:scout`:

```text
scout Qwen3-235B-A22B · outputSchema on the subagent    | 46/50
scout DeepSeek-V4-Flash · outputSchema on the subagent  | 10 of 10 child sessions failed | 0 vendors recorded | 10/22
scout Qwen3-235B-A22B · no outputSchema                 | 3-4 vendors per specialist | 0 truncations | 52/53
```

The last row moves two things at once — the model went back and the schema went away — so the strip is not
a clean attribution and should not be read as one; the traces are what separated them, and every failed
child ended in `OUTPUT_SCHEMA_NOT_FULFILLED`, several before their first search. The score is also the least
informative column. `0 vendors recorded` is the one to read: ten specialists left nothing behind, which is
the state an incremental design exists to prevent — and it could not, because nothing reached the store.

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
  `KV_REST_API_*` pair the Vercel integration injects. Without it the store reports `not_configured`.
- `NEBIUS_API_KEY` for Token Factory, `TAVILY_API_KEY` for the specialist's search tool, and a brief in
  [`evals/data/briefs.json`](../../evals/data/briefs.json) to drive an end-to-end run.
- The declared subagent from the previous recipe — a child whose entire tool surface you chose.

## Run it

```bash
npm run test:fold                 # what counts as a recorded vendor — no keys, no credits
npm run run:eve -- boston-boho    # one brief end to end, then dump the store to runs/
```

The first command prints six groups of assertions. Two of them, and the verdict line:

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

The second is the real system: [`scripts/run-eve.ts`](../../scripts/run-eve.ts) drives a brief against the
deployment, waits for the fan-out to settle, reads the findings with `listAllFindings`, and writes a
`RunResult` into [`runs/`](../../runs). What lands in that file is what the specialists wrote down as they
went — never a message any of them returned.

## Walk-through

### One call per finding

The unit of durability is the tool call, so the tool takes exactly one vendor and says so in the sentence
the model reads — [`record_vendor.ts`](../../agent/subagents/scout/tools/record_vendor.ts):

```ts
description:
  "Record ONE verified vendor you just found. Call this immediately after verifying each " +
  "vendor, before researching the next one — never batch them at the end. Recording the " +
  "same name twice updates that entry rather than duplicating it.",
```

**Name the anti-pattern next to the setting.** Batching is what a model reaches for unprompted: it writes
the report first and treats recording as bookkeeping afterwards. The [specialist's
instructions](../../agent/subagents/scout/instructions.md) close the same gap from the other side —
*"Never let a long final write-up substitute for recording as you go."*

The success return is a nudge rather than an acknowledgement, carrying the stopping rule for the category:

```ts
note:
  total >= 4
    ? "You have enough for this category — finish your report."
    : "Recorded. Research the next vendor.",
```

Four is delivered at the one moment the model is guaranteed to be reading — the result of the call it just
made. A stopping rule stated once in a system prompt competes with thirty steps of transcript; one returned
by the tool does not.

### Where a finding lands

[`research.ts`](../../agent/lib/research.ts) keeps two keys per wedding — `research:<rootSessionId>`, a
set of category slugs, and `record:<rootSessionId>:<category>`, a hash of vendor slug to JSON finding. The
write is one pipeline, and it returns the new count so the tool can nudge:

```ts
const [, , , total] = await redis([
  ["HSET", k, vendorSlug(finding.name), JSON.stringify(full)],
  ["EXPIRE", k, TTL_SECONDS],
  ["SADD", catsKey(rootSessionId), categorySlug(finding.category)],
  ["HLEN", k],
]);
```

**Idempotency is by vendor name, not by call.** The hash field is a slug of the business name, so a model
that re-records a vendor after a refusal updates it in place. A list would have grown a second copy on
every retry, and the eval's distinct-vendors check would have started failing on a system that was working
correctly. `TTL_SECONDS` is thirty days on both keys — long enough for a couple to leave mid-plan and come
back — and the `EXPIRE` rides in the same pipeline as the write, so activity refreshes the lifetime.

One line decides who a finding belongs to:

```ts
// Findings belong to the wedding, not to this child session.
const rootSessionId = ctx.session.parent?.rootSessionId ?? ctx.session.id;
```

Key by the child's own session id and every specialist writes into a private bucket the planner never
reads. The fallback keeps the tool usable when it runs under no parent at all.

### Reading it back with a health report

The read is not a `SELECT`. [`get_research.ts`](../../agent/tools/get_research.ts) joins the findings to
the live trace, so the planner receives a verdict per specialist rather than a count to interpret:

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

**The order of that ladder is load-bearing.** A stalled specialist must hear "do not wait" even when it
also had refusals, and `settled` means `completed || failed` rather than "not running" — a child parked on
an input gate is `waiting`, and telling the planner it gave up is how a duplicate gets fanned out for a
scout that is merely paused. Each branch also implies a different repair: truncated means re-run this
category with a narrower brief, all-refused means re-run with different instructions, recorded-nothing
means re-run once or tell the couple it is still open. A bare `0` cannot choose between those three, which
is the whole argument for joining the two stores at read time.

### The counter that makes zero legible

`vendorsRecorded` and `truncations` are folded out of the durable event stream in
[`trace.ts`](../../agent/lib/trace.ts), not reported by an agent about itself:

```ts
if (name === "record_vendor" && ok && (!soft || isSuccessStatus(soft))) {
  s.vendorsRecorded = readCount(s.vendorsRecorded) + 1;
}
```

The soft-status check is deliberate. `actionOutcome` reads an unrecognised status as success so a newly
added tool does not render red on arrival, and that default is exactly wrong here — an unknown status
inflates the number `get_research` decides re-runs on, and a silent gap in the plan is worse than a visible
duplicate. Every counter is read through `readCount`: a summary deserialized from KV predates whichever
field was added last, and `undefined + 1` is `NaN`, which persists as null and stops the metric for good.

Truncation comes from the model's own finish reason, at both the step and the message —
`const truncated = d.finishReason === "length"`. That is what turns "cut off" from a guess into a fact: the
event log gets the row `TRUNCATED (hit the output cap)`, and `get_research` gets a boolean it can route on.

### The return value you do not need

The companion lesson lives in [`agent.ts`](../../agent/subagents/scout/agent.ts), where the important line
is a comment: `// NO outputSchema, deliberately.`

An `outputSchema` on a long-running child looks like the responsible choice — it guarantees the shape of
the answer. What it does is escalate a formatting failure into a session failure: eve raises
`OUTPUT_SCHEMA_NOT_FULFILLED` and the whole child dies, discarding a run that may have been good until its
final message.

**State the choice, then name the failure it avoids.** The schema is gone because it was redundant *and*
fatal: findings reach the planner through `record_vendor` and the research store, never through the child's
return value, so the guarantee bought nothing and could cost everything. Deleting it did expose one field
that had been riding along — venue photos — which `get_research` now surfaces explicitly as `venue_images`
rather than leaving buried on one of forty objects.

Recording stays best-effort per vendor: when the store is unreachable the tool returns `record_failed` and
tells the scout to keep that vendor in its final report and carry on — the one place a closing report earns
its keep, as the fallback for a failed write and never as the primary channel.

### Where this transfers

The point is not weddings specifically. This pattern transfers to any domain where a sub-agent does long,
expensive, interruptible work and something downstream must tell "found nothing" apart from "died trying":
a procurement assistant collecting supplier quotes, a security triage agent working a queue of alerts, a
citation checker verifying references one at a time, a compliance crawler sampling documents against a rule
set. The unit of work is a finding, the failure is silent, and losing half an hour of tool calls costs
twice — once in credits, once in the wrong conclusion drawn from an empty list.

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

`test:fold` asserts the properties the recording design depends on: a refusal never counts as a recorded
vendor, an unrecognised status never inflates the count, a capped search never counts as a search, and a
summary written before a field existed keeps counting instead of going `NaN`. Bugs of exactly that kind
were live in `trace.ts` under a green suite, because nothing ever called the fold.

`eval:scout` grades every specialist on `vendorsRecorded >= 3` and `truncations === 0` for its category,
then judges the vendors with a model pinned away from the one under test — a model swap can move the score
but never the bar.

## Going further

- **Poll the store, not the agent.** `countByCategory` is one `HLEN` per category, cheap enough to serve on
  every refresh of [`/api/observe/session/[id]`](../../app/api/observe/session/%5Bid%5D/route.ts) — and watching
  vendors appear one at a time is the fastest way to spot a specialist that has gone quiet.
- **Decide what counts as success at the fold, not at the tool.** The tool returns a status string;
  `trace.ts` decides which strings mean a finding exists. Keeping that judgement in one place is what lets
  a new guard ship without silently moving every number downstream.
- **Give the store a lifetime on purpose.** Thirty days is a decision about how long a user may wander off
  mid-task, refreshed on every write. Pick yours from that question, not from a default.
- **Next: Guards.** Durable recording keeps whatever the specialist wrote down, including the wrong things.
  The next recipe in [the arc](../README.md) moves correctness into the tool, where a rule the model can
  ignore becomes a refusal it cannot.

## License


Part of the [Venus](../../README.md) repository, which carries no LICENSE file — no reuse rights are granted by default.
