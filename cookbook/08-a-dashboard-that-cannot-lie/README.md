# Observability — A Dashboard That Cannot Lie

> Observability that lies is worse than none, and it will lie about itself first.

Recipe **08 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → Governance → Cost → Latency → **Observability** → Evaluation → Verification

Four readings taken off the same public panel:

```text
specialists: 0 | five were running
reply understanding: 73% | the shipped classifier scores 15/15
web_search: 258 calls | 0 failures
research quality: 7/12, 58% | the scouts were still searching
```

The first was built on an event the runtime does not emit. The second reported a model that had been
reverted hours earlier. The third was true — and nothing in the system could have established that,
because `web_search` reports its own failure as `{status: "search_failed"}` and returns cleanly, so
every failed search had been counted as a healthy tool call. The fourth was arithmetic over a run
that had not finished: twelve checks graded while the specialists still searched, published beside a
cookbook citing 52/53 for the same command.

None of the four raised an error or failed a build. A panel is the one component whose defects are
indistinguishable from the news it reports, which is why it is the last place a fault gets noticed
and the first place one should be looked for.

## What you'll build

```
agent/
  hooks/observe.ts       # one hook on every durable event, folded into KV, never throws
  lib/trace.ts           # the fold — a redacted summary and event log per session
  lib/actions.ts         # one reading of eve's action protocol, and the outcome taxonomy
  lib/langsmith.ts       # deep links, verified to exist before they are handed out
  instrumentation.ts     # OTel spans → LangSmith, with the attributes eve does not send
app/
  api/observe/session/[id]/route.ts   # one whole agent tree: root plus every specialist
  observe/page.tsx                    # the public console
  _components/use-agent-lanes.ts      # one live lane per agent in the tree
  _components/observability-rail.tsx  # the same lanes, beside the chat
scripts/
  test-outcomes.mjs      # npm run test:outcomes — every tool status must be classified
  test-trace-fold.mjs    # npm run test:fold — the fold, over events in eve's real shape
```

## Prerequisites

- `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` pair) — the trace store.
- `LANGSMITH_API_KEY` **and** `LANGSMITH_TRACING=true`. The exporter's `export()` is a no-op without
  the second, so tracing looks configured and ships nothing.
- Node 24 — `package.json` declares `engines.node: "24.x"` — and `npm install` at the repo root.
- Recipe 02 (Delegation) first: a single-agent run has no tree, and the tree is where the lies live.
- One run that actually fans out. A panel with one lane cannot disagree with itself.

## Run it

The two guards below need no keys and no network. They are what stops the panel drifting away from
the runtime it reports on.

```bash
npm install
npm run test:outcomes   # every status literal a tool can return, read back out of the sources
npm run test:fold       # the fold, driven with events shaped the way eve delivers them
```

```text
22 status literals across 26 sources
  ✓ cap_reached                -> refused
  ✓ sent_to_test_inbox         -> success
  ✓ {"status":"rejected","error":{"code":"ACTION_RESULT_   -> refused
  ✓ {"result":{"output":{"status":"search_failed"}}}       -> failed
  ✓ part {"state":"output-denied"}                         -> refused

1 runtime-assembled status site(s), all vetted

outcome taxonomy: complete and correct
```

(Thirty-six further rows are elided; the run prints every one, and `npm run test:fold` closes with
`trace fold: correct`.) Twenty-two is more than the taxonomy
was first written against, and that is the only interesting thing about the count: it is allowed to
grow, and one nobody classified stops the build.

## Walk-through

### The event the documentation promises

Three features were built on `subagent.called` — a control-plane event eve 0.24.4 documents on the
parent's durable stream and does not send. Only `subagent.completed` arrives, at the end, when there
is nothing left to watch. So the console counted zero specialists during a five-way fan-out, the
browser never attached to a child stream, and the research eval concluded nothing had been delegated
and re-prompted twice, running the fan-out three times.

```text
delegations requested: 5 | specialists reported: 0 | eval re-prompts: 2 | fan-outs actually run: 3
```

The triple run is the expensive part and it is downstream. The counter was the cause. The delegation
is now counted where it is genuinely visible — at the request — in
[`trace.ts`](../../agent/lib/trace.ts):

```ts
// `subagent.called` is not delivered on the parent's durable stream in
// eve 0.24.4 (only `subagent.completed` is), so count the delegation
// where it IS visible: the request itself.
if (isSubagentAction(a)) {
  s.subagents += 1;
```

Lanes are discovered the same way, from the tree rather than the announcement: each child writes its
own summary linked by `ctx.session.parent`, and
[`use-agent-lanes.ts`](../../app/_components/use-agent-lanes.ts) reads both sources, taking whichever
names a child first. The `subagent.called` handler was kept and demoted to a log enrichment — *"this
only enriches the log when eve does deliver it."* Deleting it would have been a bet the other way.

**Verify that the event you built on is actually emitted, not merely documented.** A missing event
does not throw. It produces a zero, and a zero on a dashboard reads as a calm system.

### One reading of "did this work"

`web_search` does not raise when Tavily refuses it. It returns `{status: "search_failed"}`, and the
runtime sees a tool that completed. Nineteen distinct status literals existed across the tools at the
time, and the first attempt at a fix classified three of them:

```text
literals in the sources: 19 | covered by the first fix: 3 | blocked: 4 uses | not_found: 6 | not_configured: 11
```

`cap_reached` and `unavailable` still counted as healthy. Covering three is not a smaller version of
the bug; it is the same bug with a shorter list.

The taxonomy now lives in [`actions.ts`](../../agent/lib/actions.ts), beside `actionName`, for the
reason that one already lived there — the trace store, the live rail and the stack diagram each
carried a private copy of "did this work", and all three were wrong the same way:

```ts
export const REFUSED_STATUSES = ["blocked", "cap_reached", "no_query"] as const;

/** The tool could not do its job. */
export const FAILED_STATUSES = [
  "search_failed", "record_failed", "not_configured", "not_found", "unavailable",
] as const;
```

**Three buckets, not two.** A guard declining a directory source is the system working; an outreach
round where every send hit the daily cap must not read like one where every send landed. `dry_run`
and `sent_to_test_inbox` sit in `SUCCESS_STATUSES` on purpose: the deployment mode decided them, not
the input, and the tool did what that mode asks.

Two rounds of review then found the same defect one level up — the table right, the code consuming it
wrong:

```ts
export function actionOutcome(data: Any): ActionOutcome {
  const status = String(data?.status ?? "");
  if (status === "rejected") return "refused";
  if (status === "failed" || data?.error || data?.result?.isError) return "failed";
  return outcomeFromStatus(actionStatus(data));
}
```

**The anti-pattern is reading `data.error` first.** eve's `createActionResultEvent` attaches an error
to a *rejected* result as well as a failed one — `buildActionResultError` never returns undefined —
so testing the error payload before the status swallows every approval-gate denial into "failed" and
pins `refusedActions` at zero forever. The rail displayed one refusal as both failed and refused.
**Unit-testing the taxonomy while nothing exercised the fold that consumes it is how a correct table
and an incorrect reading of it shipped together, twice.**
[`test-trace-fold.mjs`](../../scripts/test-trace-fold.mjs) exists for that, and its `rejected` fixture
carries the `error` key eve really sends — without it the fixture passes against the broken code.

### Counting requests is not counting work

The `tools` map is folded at `actions.requested`, before the tool runs, so it counts intent. A search
refused at the budget cap never reaches Tavily — reported as a search, it is how a scout came to show
30 searches against a cap of 25. Every surface subtracts `toolsRefused` first, through the one
`toolRuns` that the rail, `get_research` and the run script all call. The default for an *unrecognised*
status then changes by consumer, deliberately: `actionOutcome` reads one as success so a new tool does
not render red on arrival, while `vendorsRecorded` requires a recognised success. **State the choice,
then name the failure the choice avoids.** `get_research` reads that counter to decide whether a
category needs re-running, so an unknown status inflating it reports a category that found nothing as
covered — and a silent gap in a plan is worse than a visible duplicate. That was the live fault.

### A summary outlives the configuration it was measured on

`/observe` publicly displayed 73% for reply understanding while the shipped configuration scored 15 of
15. The classifier had been reverted; the eval was never re-run; KV kept the losing model's summary.
The mechanism is two files that never meet — `scripts/eval-replies.ts` stamps the summary with the
model it ran on, and [`page.tsx`](../../app/observe/page.tsx) prints that stamp beside the score:

```ts
await saveEvalSummary({
  kind: "replies",
  name: "Vendor-reply understanding (classifyReply intent)",
  ranAt: new Date().toISOString(),
  model,
```

The live routing is rendered elsewhere on that same page, from `modelRouting()`. Nothing compares the
two. The record was corrected by re-running the eval; the structural fix — the console flagging a
summary whose model no longer matches the routing — is recommended in
[`decisions.json`](../../evals/data/decisions.json) and **is not built**. It is named here rather than
implied, because a recipe about a panel that lies should not imply its own is finished.

**A score measures a configuration; it is not a property of a product.** Store what it ran on, render
what it ran on, and treat a stale pairing as a defect of the same class as a wrong number.

### A score of a run that had not finished

The same panel served `7/12, 58%` for research quality while `/cookbook` cited 52/53 for the same
command. Neither number was wrong. [`eval-scout.ts`](../../scripts/eval-scout.ts) waits for the
fan-out to go quiet before it reads anything — that wait exists because grading early once scored
"0 recorded" against scouts that were still searching — but when the wait gives up, the script grades
anyway and saves the result like any other summary. The stored run had settled nothing: its first
case read `expected "completed", got "waiting (32s)"` against the 114s a real fan-out takes, and it
carried twelve checks where a settled run produces thirty-seven to fifty-three.

The fix is not a better score, it is refusing to call that a score. The summary carries the reason it
must not be read as one:

```ts
incomplete: unsettled.length
  ? `specialists never settled on ${unsettled.join(", ")} within ${SPECIALIST_SETTLE_MS / 1000}s — ` +
    "these checks graded a run still in flight, so this is a reading of timing, not of research quality"
  : null,
```

[`page.tsx`](../../app/observe/page.tsx) renders such a summary as *"not scored"* with that reason
beneath it rather than as a percent chip, `npm run report` prints NOT SCORED in place of the
percentage, and the script says so on stdout before it saves. The counts stay visible — the run is
still evidence of something, it just stops being a verdict.

**A precondition that failed is not a low score, it is no score.** Nothing here was wrong about the
arithmetic; it was wrong about what the arithmetic meant, which is the reading no build can catch —
every digit on screen checks out, and the heading above them is the lie.

### A broken link looks like working tracing

LangSmith derives a run id from the OTel **span** id, zero-padded into a UUID. The exporter in
[`instrumentation.ts`](../../agent/instrumentation.ts) was storing the 32-character **trace** id, so
every "Open trace in LangSmith" button led to a 404 — invisibly, because nothing on this side ever
fetched what it was offering. [`langsmith.ts`](../../agent/lib/langsmith.ts) now refuses to return a
URL it has not checked:

```ts
export async function traceUrl(runId: string | null | undefined): Promise<string | null> {
  if (!runId) return null;
  const ref = await getProjectRef();
  if (!ref) return null;
  if (!(await runExists(runId))) return null;
  return `${webHost()}/o/${ref.tenantId}/projects/p/${ref.id}/r/${runId}?poll=true`;
}
```

`null` is a first-class answer, and
[`observability-rail.tsx`](../../app/_components/observability-rail.tsx) renders it as a caption
rather than a link — *"LangSmith · trace pending"* when a key is set, *"LangSmith · off"* when it is
not. **A dead link is worse than a disabled one, because it looks like the tracing is working.** The
reader who clicks concludes the pipeline is fine and the run is missing; the reader who sees a
disabled control concludes something is not ready, which is true. The same instinct puts a
`console.warn` in `setup` when `LANGSMITH_API_KEY` is set and `LANGSMITH_TRACING` is not.

### What this panel still cannot tell you

The eval-versus-routing check is not built, and neither is any repair for an incomplete run:
`incomplete` marks a summary unscored, and nothing re-runs it or expires it from KV. Live lanes are
capped at `MAX_ATTACHED = 5` attached
streams, root included, and each log is trimmed to `MAX_EVENTS = 600` rows on a 30-day TTL, so a long run is a summary
plus its tail. A status assembled at runtime cannot be read out of the source at all, so
[`test-outcomes.mjs`](../../scripts/test-outcomes.mjs) carries a hand-maintained `DYNAMIC_ALLOWED` map
naming every value one such site can take. And the store is redacted at write time — nothing the
couple typed reaches KV beyond the budget figure the summary title carries, only shape — which is what makes `/observe` safe to leave public, and means
no question about *what was said* can ever be answered here, by anyone.

### Taking it somewhere that is not a wedding

The point is not weddings specifically. This pattern transfers to any domain where a fan-out of
tool-calling workers reports its own progress and someone downstream acts on the report: a
document-review pipeline whose extractors return a per-page status, an incident-triage bot whose
enrichment calls fail soft against a rate-limited vendor API, a procurement assistant polling supplier
catalogs, a moderation queue where a policy refusal and a classifier error look identical from
outside. In all of them a worker returns "I could not" as a well-formed success, some counter is
folded before the work happens, and some link points at an id from the wrong namespace. Give refusal
its own bucket; count work at the result, not the request; verify a deep link before rendering it;
stamp every score with the configuration it measured. The domain changes what the workers do. It does
not change that a panel is a program, and programs are wrong.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| The panel reports 0 specialists while several are running | Built on `subagent.called`, which eve 0.24.4 does not deliver on the parent's durable stream | Count at `actions.requested`; discover children from the trace tree ([`trace.ts`](../../agent/lib/trace.ts)) |
| A failed search never appears anywhere | The tool reports failure in its payload and returns cleanly, so nothing counting exceptions sees it | `FAILED_STATUSES`, read off `result.output.status` ([`actions.ts`](../../agent/lib/actions.ts)) |
| Approval-gate denials count as failures; `refusedActions` is stuck at 0 | `data.error` is read before `data.status`, and eve attaches an error to a rejection too | Read `status` first in `actionOutcome`; the `test:fold` fixture carries the error key |
| The search count exceeds the configured budget cap | `tools` counts calls *requested*; a capped call never ran | Subtract `toolsRefused` through `toolRuns` before any surface reports it |
| An eval score contradicts the deployed configuration | The summary stores the model it ran on; nothing compares that to the live routing | Re-run the eval. The automatic flag is recommended in `decisions.json` and not built |
| An eval score is a reading of timing, not of quality | The wait for the specialists to settle gave up and the script graded the run anyway | `EvalSummary.incomplete` carries the reason; `/observe` and `npm run report` render the run unscored |
| "Open trace in LangSmith" always 404s | The URL was built from the OTel trace id, not the run id LangSmith derives from a span id | `langsmithRunId` pads the span id; `traceUrl` fetches the run and returns `null` if it is absent |
| The LangSmith project stays empty and nothing errors | `LANGSMITH_API_KEY` set, `LANGSMITH_TRACING` unset — the exporter drops every span | `instrumentation.ts` warns loudly at `setup` rather than starting quietly |
| Observability takes the app down with it | A hook that throws fails the turn | The observe hook swallows and warns; `recordTraceEvent` never throws |

## Test it

```bash
npm run verify   # typecheck · next build · eve build · test:guards · test:outcomes · test:fold · cookbook:check
```

What that suite guarantees is that the panel's readings are *derived* rather than asserted.
`test:outcomes` reads every status literal back out of the tool sources and fails on one the taxonomy
does not classify, so renaming a status breaks a build instead of zeroing a metric. `test:fold` drives
`apply()` — the real fold, exported for this purpose — with events in eve's delivered shape, so a
refusal is never counted as a failure and a capped search is never counted as a search. Neither
asserts a number that appears on screen, and nothing offline can check a LangSmith link: that one is
verified at request time, on every render, by fetching the run before the URL is returned.

## Going further

- **Compare the eval's recorded model against the live routing, and flag the mismatch on the page.**
  Both values are already in memory in [`page.tsx`](../../app/observe/page.tsx) — `EvalSummary.model`
  and `modelRouting()`. It is a comparison, not a feature, and it is the one gap this recipe leaves
  open on purpose.
- **Make the redaction rule enforceable rather than remembered.**
  [`trace.ts`](../../agent/lib/trace.ts) keeps the couple's words out of KV by convention, in the
  `message.received` branch of `apply()` and in `describeAction`. A test that folds a message carrying a marker string and asserts it never reaches
  the written entry would turn that convention into a guard.
- **Read the record this was built from.** [`decisions.json`](../../evals/data/decisions.json) and the
  generated [engineering log](../../docs/engineering-log.md) carry all four faults with their dates,
  including the two follow-up fixes that each failed for the same reason one level down.
- **Next: [Evaluation — Hold the Set, Pin the Judge](../09-hold-the-set-pin-the-judge/).** A panel
  that cannot lie about a run still says nothing about whether the run was any good. The next recipe
  is about the scores this one is careful to stamp — where they come from, and what a passing suite
  is still unable to see.

## License

Part of the [Venus](../../README.md) repository, which carries no LICENSE file — no reuse rights are granted by default.
