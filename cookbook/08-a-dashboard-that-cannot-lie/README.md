# Observability — A Dashboard That Cannot Lie

> An observability panel that shows false data is worse than no panel, and it shows false data about itself first.

This is recipe **08 of 10** in the Venus Blueprint Recipes sequence:

> Foundation → Delegation → Durability → Guards → Governance → Cost → Latency → **Observability** → Evaluation → Verification

The same public panel gave these four readings:

```text
specialists: 0 | five were running
reply understanding: 73% | the shipped classifier scores 15/15
web_search: 258 calls | 0 failures
research quality: 7/12, 58% | the scouts were still searching
```

The first reading used an event that the runtime does not emit. The second reading showed a model
that the team reverted hours earlier. The third reading was true, but the system could not prove it.
`web_search` reports its own failure as `{status: "search_failed"}` and returns without an error.
Thus the panel counted every failed search as a healthy tool call.

The fourth reading was arithmetic over a run that had not finished. The eval graded twelve checks
while the specialists still searched. The panel published the score beside a cookbook that cites
52/53 for the same command.

None of the four readings caused an error or a build failure. A defect in a panel looks the same as
the data that the panel reports. For this reason, you notice a fault in the panel last. Look for a
fault in the panel first.

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
  the second variable, so tracing looks configured but sends nothing.
- Node 24 — `package.json` declares `engines.node: "24.x"` — and `npm install` at the repo root.
- Complete Recipe 02 (Delegation) first. A single-agent run has no tree, and the false readings occur in the tree.
- One run that fans out. A panel with one lane cannot disagree with itself.

## Run it

The two guard commands below need no keys and no network. These guards make sure that the panel
agrees with the runtime that it reports on.

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

(This example does not show thirty-six more rows. The run prints every row, and `npm run test:fold`
ends with `trace fold: correct`.) The first version of the taxonomy had fewer than twenty-two
literals. The count can grow. One literal without a classification stops the build.

## Walk-through

### The event the documentation promises

Three features used `subagent.called`, a control-plane event. eve 0.24.4 documents this event on the
parent's durable stream, but eve does not send it. Only `subagent.completed` arrives, and it arrives
when the work is complete.

Thus the panel counted zero specialists during a five-way fan-out. The browser never attached to a
child stream. The research eval decided that no delegation occurred, and it re-prompted twice. The
fan-out ran three times.

```text
delegations requested: 5 | specialists reported: 0 | eval re-prompts: 2 | fan-outs actually run: 3
```

The triple run is the expensive part, and it is a downstream effect. The counter was the cause.
[`trace.ts`](../../agent/lib/trace.ts) now counts the delegation at the request, where the
delegation is visible:

```ts
// `subagent.called` is not delivered on the parent's durable stream in
// eve 0.24.4 (only `subagent.completed` is), so count the delegation
// where it IS visible: the request itself.
if (isSubagentAction(a)) {
  s.subagents += 1;
```

The panel discovers lanes the same way, from the tree and not from the announcement. Each child
writes its own summary, linked by `ctx.session.parent`.
[`use-agent-lanes.ts`](../../app/_components/use-agent-lanes.ts) reads both sources and uses the
source that names a child first. The `subagent.called` handler stays, but now it only enriches the
log — *"this only enriches the log when eve does deliver it."* A deleted handler would be an
assumption in the other direction.

**Verify that the runtime emits the event that your feature uses. Documentation is not proof.** A
missing event does not throw an error. It produces a zero, and a zero on a panel looks like a
healthy system.

### One reading of "did this work"

`web_search` does not throw an error when Tavily refuses a search. It returns
`{status: "search_failed"}`, and the runtime sees a completed tool. At that time, the tools
contained nineteen distinct status literals. The first fix classified three of them:

```text
literals in the sources: 19 | covered by the first fix: 3 | blocked: 4 uses | not_found: 6 | not_configured: 11
```

The panel still counted `cap_reached` and `unavailable` as healthy. A fix that covers three
literals is not a smaller version of the bug. It is the same bug with a shorter list.

The taxonomy now lives in [`actions.ts`](../../agent/lib/actions.ts), beside `actionName`. Before
this change, the trace store, the live rail, and the stack diagram each carried a private copy of
"did this work". All three copies were wrong in the same way:

```ts
export const REFUSED_STATUSES = ["blocked", "cap_reached", "no_query"] as const;

/** The tool could not do its job. */
export const FAILED_STATUSES = [
  "search_failed", "record_failed", "not_configured", "not_found", "unavailable",
] as const;
```

**Use three buckets, not two.** When a guard refuses a directory source, the system operates
correctly. An outreach round where every send hit the daily cap must not look like a round where
every send arrived. `dry_run` and `sent_to_test_inbox` are in `SUCCESS_STATUSES` by design. The
deployment mode caused these statuses, not the input, and the tool did what the mode requires.

Two review rounds then found the same defect one level up. The table was correct, but the code that
reads the table was wrong:

```ts
export function actionOutcome(data: Any): ActionOutcome {
  const status = String(data?.status ?? "");
  if (status === "rejected") return "refused";
  if (status === "failed" || data?.error || data?.result?.isError) return "failed";
  return outcomeFromStatus(actionStatus(data));
}
```

**Do not read `data.error` before the status.** eve's `createActionResultEvent` attaches an error
to a *rejected* result and to a failed result. `buildActionResultError` never returns undefined.
Code that tests the error payload before the status counts every approval-gate denial as "failed".
The counter `refusedActions` then stays at zero. The rail displayed one refusal as failed and as
refused.

**Test the fold that reads the taxonomy, not only the taxonomy.** A unit test of the table alone let
a correct table and an incorrect reading of the table ship together, twice.
[`test-trace-fold.mjs`](../../scripts/test-trace-fold.mjs) tests the fold. Its `rejected` fixture
carries the `error` key that eve really sends. Without that key, the fixture passes against the
broken code.

### Counting requests is not counting work

The fold counts the `tools` map at `actions.requested`, before the tool runs, so the map counts
intent. A search that the budget cap refuses never reaches Tavily. The panel reported such a search
as a search, and thus a specialist showed 30 searches against a cap of 25. Every surface now
subtracts `toolsRefused` first, through the one `toolRuns` function that the rail, `get_research`,
and the run script call.

The default for an *unrecognised* status changes by consumer, by design. `actionOutcome` reads an
unrecognised status as a success, so a new tool does not show as red on arrival. `vendorsRecorded`
requires a recognised success. **State the choice, then name the failure that the choice prevents.**

`get_research` reads that counter to decide whether a category needs a new run. An unknown status
that inflates the counter reports an empty category as covered. A silent gap in a plan is worse than
a visible duplicate. That was the live fault.

### A summary outlives the configuration it was measured on

`/observe` publicly displayed 73% for reply understanding, while the shipped configuration scored
15 of 15. The team had reverted the classifier, but no one ran the eval again. KV kept the summary
of the losing model. The mechanism is two files that never interact. `scripts/eval-replies.ts`
stamps the summary with the model that the eval ran on.
[`page.tsx`](../../app/observe/page.tsx) prints that stamp beside the score:

```ts
await saveEvalSummary({
  kind: "replies",
  name: "Vendor-reply understanding (classifyReply intent)",
  ranAt: new Date().toISOString(),
  model,
```

The same page renders the live routing elsewhere, from `modelRouting()`. Nothing compares the two
values. A new eval run corrected the record. The structural fix is a flag on the panel for a summary
whose model no longer matches the routing.
[`decisions.json`](../../evals/data/decisions.json) recommends that fix, and the fix **is not
built**. This recipe names the gap, because a recipe about false panel data must not hide its own
gaps.

**A score measures a configuration, not a product.** Store the configuration that the eval ran on.
Render that configuration beside the score. Treat a stale pair as a defect of the same class as a
wrong number.

### A score of a run that had not finished

The same panel served `7/12, 58%` for research quality, while `/cookbook` cited 52/53 for the same
command. Neither number was wrong. [`eval-scout.ts`](../../scripts/eval-scout.ts) waits until the
fan-out is quiet before it reads anything. That wait exists because an early grade once scored
"0 recorded" against specialists that still searched. But when the wait stops, the script grades the
run and saves the result like any other summary.

The stored run had settled nothing. Its first case read
`expected "completed", got "waiting (32s)"`, against the 114s that a real fan-out takes. It carried
twelve checks, where a settled run produces thirty-seven to fifty-three.

The fix is not a better score. The fix is a refusal to call that result a score. The summary
carries the reason:

```ts
incomplete: unsettled.length
  ? `specialists never settled on ${unsettled.join(", ")} within ${SPECIALIST_SETTLE_MS / 1000}s — ` +
    "these checks graded a run still in flight, so this is a reading of timing, not of research quality"
  : null,
```

[`page.tsx`](../../app/observe/page.tsx) renders such a summary as *"not scored"*, with the reason
below it and with no percent chip. `npm run report` prints NOT SCORED in place of the percentage.
The script also prints this on stdout before it saves. The counts stay visible. The run is still
evidence, but it is not a verdict.

**A failed precondition is not a low score. It is no score.** The arithmetic was correct. The
meaning of the arithmetic was wrong, and no build can catch a wrong meaning. Every digit on the
screen is correct, and the heading above the digits is false.

### A broken link looks like working tracing

LangSmith derives a run id from the OTel **span** id, zero-padded into a UUID. The exporter in
[`instrumentation.ts`](../../agent/instrumentation.ts) stored the 32-character **trace** id. Thus
every "Open trace in LangSmith" button led to a 404. No one saw the fault, because nothing on this
side fetched the URL that it offered. [`langsmith.ts`](../../agent/lib/langsmith.ts) now refuses to
return a URL that it has not checked:

```ts
export async function traceUrl(runId: string | null | undefined): Promise<string | null> {
  if (!runId) return null;
  const ref = await getProjectRef();
  if (!ref) return null;
  if (!(await runExists(runId))) return null;
  return `${webHost()}/o/${ref.tenantId}/projects/p/${ref.id}/r/${runId}?poll=true`;
}
```

`null` is a valid answer.
[`observability-rail.tsx`](../../app/_components/observability-rail.tsx) renders it as a caption, not as a link. The caption shows *"LangSmith · trace pending"* when a key is set, and *"LangSmith · off"* when no key is set. **A dead link is worse than a disabled control, because a dead link looks like working
tracing.** A reader who clicks a dead link decides that the pipeline works and that the run is lost.
A reader who sees a disabled control decides that a part is not ready, and that is true. For the
same reason, `setup` calls `console.warn` when `LANGSMITH_API_KEY` is set and `LANGSMITH_TRACING`
is not.

### What this panel still cannot tell you

The eval-versus-routing check is not built, and neither is any repair for an incomplete run. `incomplete` marks a summary unscored. Nothing re-runs it or expires it from KV. Live lanes are capped at `MAX_ATTACHED = 5` attached streams, root included. Each log is trimmed to `MAX_EVENTS = 600` rows on a 30-day TTL. Thus a long run is a summary plus its tail. A status assembled at runtime cannot be read out of the source at all. For this case,
[`test-outcomes.mjs`](../../scripts/test-outcomes.mjs) carries a hand-maintained `DYNAMIC_ALLOWED` map
that names every value one such site can take. And the store is redacted at write time. Nothing the couple typed reaches KV beyond the budget figure in the summary title — the store keeps only shape. This redaction makes `/observe` safe to leave public. No person can use this store to answer a question about *what was said*.

### Taking it somewhere that is not a wedding

The point is not weddings specifically. This pattern transfers to any domain where tool-calling workers report their own progress and a downstream reader acts on the report. Examples: a document-review pipeline whose extractors return a per-page status; an incident-triage bot whose enrichment calls fail soft against a rate-limited vendor API; a procurement assistant that polls supplier catalogs; a moderation queue where a policy refusal and a classifier error look identical from outside. In all of them, a worker returns "I could not" as a well-formed success. Some counter is folded before the work happens. Some link points at an id from the wrong namespace. Give refusal
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
`test:outcomes` reads every status literal back out of the tool sources and fails on one the taxonomy does not classify. Thus a renamed status breaks a build instead of zeroing a metric. `test:fold` drives `apply()` — the real fold, exported for this purpose — with events in eve's delivered shape. Thus a refusal is never counted as a failure. A capped search is never counted as a search. Neither asserts a number that appears on screen, and nothing offline can check a LangSmith link. The link is verified at request time, on every render: the server fetches the run before it returns the URL.

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
  that cannot lie about a run still says nothing about whether the run was any good. The next recipe is about the scores this one is careful to stamp. It shows where the scores come from, and what a passing suite is still unable to see.

## License

Part of the [Venus](../../README.md) repository, which carries no LICENSE file — no reuse rights are granted by default.
