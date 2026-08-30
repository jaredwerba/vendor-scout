# What the Nebius cookbook does not cover

A coverage map of all ten Agent Blueprint Recipes plus the Sentinel blueprint, read in full on
2026-08-30, against what a production agent actually hits. The purpose is not criticism — the
corpus is unusually good, and the last section lists what it covers so well that nobody should
re-derive it. The purpose is to find the holes worth filling.

Every gap below was checked against the text before being called a gap. Where a keyword search
was the evidence, the search is named. Where something IS covered but only in the blueprint
rather than in a teachable recipe, that is said rather than counted as absence.

Eleven gaps. 8 of them are things this repository already hit in production and has a dated
decision record for — which is the reason this document exists rather than a list of opinions.

## The gaps

### 1. No runnable evaluation anywhere in the ten recipes ★

**What is missing.** A recipe that builds an eval set, scores agent output against it, and gates a release on the
result. Nothing in the ten recipes measures whether the agent is CORRECT — only that transport,
memory, guardrails and approvals mechanically work.

**Evidence.** Recipe 10 (Simulation/Snowglobe), the designated eval recipe, is a scaffold: `find
cookbooks/10-testing-before-production-snowglobe -type f` returns only recipe.json, README.md,
docs/.gitkeep, assets/.gitkeep. Its README opens '🚧 Scaffold only. This recipe is planned but
not yet implemented.' Every other recipe defers to it: #03 failure table says 'Missing citations
| Model ignored the format | Add a critic/eval step in a later cookbook'; #04 lists 'evaluators'
only in recipe.json as future growth; #07 Going Further says 'Export failed-run examples into
datasets for future evaluation.' `find cookbooks -type d -name 'eval*'` returns nothing.
Sentinel DOES have real eval (scripts/validate_run.py, per-class F1, 420 ground-truth pairs in
compliance_matrix_revised.json), but it is a blueprint app, not a teaching recipe, and the
method is never extracted into transferable form.

**Why it matters.** A reader can complete the entire arc and ship an agent with literally no way to tell whether a
prompt change, a model swap, or a guardrail edit made output better or worse. Every other
recipe's advice (route deliberate vs direct, recall 5 memories, buffer and validate output) is
unfalsifiable without this. It is the single largest hole because it invalidates the reader's
ability to verify anything else the corpus taught.

**What a recipe covering it would have to demonstrate.** Build a labelled set from real traces, score with both a deterministic checker and an LLM judge,
report per-class precision/recall rather than one aggregate score, show judge-vs-human agreement
so the judge itself is calibrated, and gate CI on a DELTA against a baseline rather than an
absolute score. Must show a case where the aggregate score improved while a subclass regressed.

### 2. Cost is computed and displayed, but never validated ★

**What is missing.** Any treatment of whether the dollar figure the agent reports is actually correct. The corpus
teaches emitting cost, never checking it.

**Evidence.** Recipes #02 and #03 emit `costUsd` on the done event, priced from `GET /v1/models?verbose=true`
with `NEBIUS_*_PRICE_PER_MILLION_TOKENS` env fallback; #04 prints 'Cost: $0.000399'; Sentinel
publishes a cost table (~$12 / ~$64 / ~$140 per full audit) and centralises pricing in
config.PRICING. But corpus-wide grep over all cookbook READMEs, the Sentinel README, root README
and docs/ returns ZERO hits for `cached`, `prompt cach`, `prompt_tokens`, `cached_tokens` — the
single 'cach' hit in the reader surface is `local.py # SOP file loading and search (cached
parse)`, which is file parsing, not token caching. #02's own sample payload ships
`"costUsd":0.0` and `Cost: 0.000000 USD` without remarking that a zero cost is suspicious.

**Why it matters.** Cost is the number executives act on and the number nobody checks, because a wrong one throws no
exception. Two specific arithmetic traps are guaranteed on the OpenAI-compatible wire that all
ten recipes use: prompt_tokens ALREADY includes cached_tokens (adding them double-counts), and
the model id in a trace may carry a provider prefix that will not key into a bare-id price
table. The corpus hands the reader a cost display and none of the arithmetic hazards behind it.

**What a recipe covering it would have to demonstrate.** Recompute a known-price run by hand and reconcile against the provider invoice; show a $0 cost
being diagnosed to a model-id lookup miss; show prefix-peeling until an id matches the price
table; show that adding cached_tokens to prompt_tokens inflates the bill, with the cache-hit
rate reported separately; and require `includeUsage` on streamed turns, which otherwise report
zero tokens.

### 3. Structured-output reliability treated as a separate axis from correctness ★

**What is missing.** Anything about whether a model reliably produces the SHAPE you demanded — JSON schema
conformance, response_format, and its interaction with tool calling. The corpus validates output
for safety, never for shape.

**Evidence.** Corpus-wide grep across all ten cookbook READMEs, Sentinel, root README and docs returns ZERO
hits for `structured output`, `response_format`, `json_schema`, and `outputSchema`. Recipe #08
does buffer and validate output before emitting (`GUARDRAILS_MAX_OUTPUT_CHARS`, output claim
checks) but explicitly as a safety boundary — topic, PII, prompt injection — never as schema
conformance. Recipe #09 gets structure from the FastAPI/Pydantic layer and a seeded catalog, not
from the model. Sentinel's `record_finding` and JSON parsing/repair tests are the closest thing,
but the README frames them as parsing robustness, not as a model-selection criterion.

**Why it matters.** Content correctness and shape reliability are different axes and they do not correlate. A model
can win an accuracy comparison and still fail a meaningful fraction of its structured emissions,
which shows up as silent data loss rather than as an error. Worse, imposing a JSON-schema
constraint on a tool-calling agent can make some open models stop calling tools entirely — a
total failure mode that a correctness benchmark will never surface. The corpus tells readers to
pick models (#04 routing, Sentinel's three tiers) with no warning that shape is a separate
qualification.

**What a recipe covering it would have to demonstrate.** Run the same model on the same task with and without a schema constraint, report content
accuracy and shape-conformance as two independent numbers, show a cheaper model winning on one
and losing on the other, and demonstrate the tool-calling-plus-schema interaction killing a run.
Show the repair/retry ladder and when to drop the constraint instead.

### 4. Multi-agent delegation and inherited tool authority ★

**What is missing.** Any recipe with more than one agent, and any treatment of what tools a child agent inherits from
its parent. Delegation is the most common next step after recipe #04 and the corpus never takes
it.

**Evidence.** Grep for `delegat` across the reader surface returns NONE; `subagent|sub-agent` hits only
Sentinel. A per-directory scan for `subagent|sub_agent|delegate` across all ten cookbook trees
returns 0 for every one — all ten recipes are a single agent with a single graph. Sentinel does
fan out per-SOP sub-agents via ThreadPoolExecutor with MAX_AUDIT_WORKERS, but its README
describes the child's tool list descriptively (read_sop, retrieve_regulation_rag, search_web,
record_finding) and never frames that surface as a safety boundary or discusses inheritance.
Recipe #09 teaches human approval for a single agent's action and states 'Do not let tool
discovery become tool authority' — but only about MCP tool exposure to one agent, never about a
child inheriting the parent's action tools.

**Why it matters.** The moment a reader adds delegation on top of recipe #09, the approval boundary #09 built can be
bypassed: a framework that spawns a child by cloning the parent gives that child every tool the
parent had, including the irreversible one. The capability is inherited rather than granted, and
nothing in the corpus tells the reader to check. A guarantee that depends on a model choosing
not to use a tool it possesses is not a guarantee.

**What a recipe covering it would have to demonstrate.** Spawn a child two ways — cloned-from-parent versus explicitly declared with an allowlisted tool
surface — and show the cloned child reaching for a side-effecting tool. Prove absence beats
prohibition by shadowing the inherited tool with one that refuses, then show the count of
attempts in the trace to prove the model still tries.

### 5. Verifying that your telemetry is true, not merely present ★

**What is missing.** Any method for confirming an observability signal actually fires and reports reality. The corpus
teaches building dashboards and traces, never auditing them.

**Evidence.** Recipe #07 builds a full LangSmith trace tree and its failure table covers 'Agent works but
trace is missing' and 'langsmithRunId is null' — i.e. absent signal — but has no row for a
signal that is present and wrong. Its checklist says 'Attach deployment version, model id, and
cookbook name to every trace,' which is the right instinct but is one unexplained bullet with no
demonstration of the staleness it prevents. #08 warns 'Guardrail metrics are flat | Route
bypasses policy' — the closest hit in the corpus — and #09 exports
`stripe_mcp_requests_total{tool,outcome}`, but nothing shows an outcome label being wrong. Grep
for `actually emit`, `never emit`, `documented but`, `promised` across the reader surface
returns nothing relevant. docs/deployment.md covers rollback and healthchecks but contains no
smoke-verification of emitted telemetry.

**Why it matters.** Observability is the layer a reader trusts to tell them everything else is fine, so a wrong
signal is worse than no signal: it converts an outage into a silence. Three concrete traps are
unguarded — building a feature on a documented event the runtime never actually emits, recording
a failed tool call as a successful one so nothing counting exceptions ever sees it, and a
dashboard confidently reporting a model or version that was reverted hours earlier. A pipeline
that shells out and checks the exit status of the wrong command in the pipe has the same shape.

**What a recipe covering it would have to demonstrate.** Assert the event you depend on is emitted before shipping a consumer of it; reconcile a counter
against an independent source (trace tree vs metric) and show them disagreeing; record tool-call
outcome from the result rather than from the absence of an exception; stamp deployed
model/version into the trace and show a stale dashboard being caught by that stamp.

### 6. Partial-progress durability for long multi-step runs ★

**What is missing.** A recipe showing incremental result capture, and the distinction between an empty result and a
truncated one. The recipes teach the opposite discipline and never revisit it for long runs.

**Evidence.** Recipes #05 and #06 both teach write-after-success: 'Keep memory writes after successful model
completion so failed runs do not pollute context' and 'After the stream completes, the route
saves the new turn.' Correct for a chat turn, but the corpus never says the trade-off inverts
for long work. Sentinel DOES solve it — 'record_finding (per requirement, survives truncation)'
and 'findings are captured incrementally so partial progress survives truncation or errors' —
but only inside the blueprint, only twice, and the lesson is never generalised into a recipe.
Grep for `truncat` across the reader surface hits Sentinel only. #04 budgets output tokens per
route but never discusses what happens when a run is cut off mid-work.

**Why it matters.** Any agent that produces a list of findings over many steps, and returns them in one closing
structure, makes every result hostage to the last token. When it truncates, the run loses
everything and — the expensive part — 'zero results' becomes indistinguishable from 'nothing
exists', so a supervising layer cannot tell failure from a legitimate empty answer and will
either re-run everything or accept a false negative.

**What a recipe covering it would have to demonstrate.** Write each unit of work down the moment it is produced rather than at the end, join those
records to the live trace so a caller can distinguish a truncated worker from an empty one, and
re-run only the failed unit. Show the cost difference between selective re-run and full re-run.

### 7. Cancellation and spend-stop is taught once, then dropped as the stack grows ★

**What is missing.** Cancellation semantics for the later, more expensive recipes. Recipe #01 solves this well; no
recipe from #02 to #09 re-addresses it even as each adds costlier work behind the same SSE
endpoint.

**Evidence.** PARTIALLY COVERED, ranked accordingly. Recipe #01 genuinely teaches it: a background task polls
`request.is_disconnected()`, sets a cancel_event, and the agent stops pulling from Nebius —
'otherwise a user closing a tab still costs you a full generation.' Sentinel also covers it:
'Stop aborts the stream and the server cancels the LangGraph run, so the spend actually stops.'
But grep for `cancel|abort` across the reader surface hits only 01, 05 and Sentinel — and in #05
it is a bare `cancel_event=cancel_event` inside a code block with zero surrounding prose. #02
and #03 fan out an embedding call, a top-k lookup, related-knowledge passes, a Tavily search and
a 70B generation with no cancellation mention. #09 holds a pending approval with
`APPROVAL_TTL_SECONDS=900` and an MCP call with no story for a client that hangs up mid-
approval.

**Why it matters.** Cancellation gets harder exactly as the corpus gets more expensive, and the recipe that solved
it is the cheapest one. A disconnect during #01 wastes one generation; a disconnect during #09
can leave a pending approval that later actuates, and a disconnect during a Sentinel-shaped fan-
out keeps many workers spending. Durable and queued execution make this worse, because the run
outlives the connection by design.

**What a recipe covering it would have to demonstrate.** Propagate one cancellation token through a fan-out and a durable/queued run, prove spend
actually stops by showing token accounting before and after, and define what happens to an in-
flight approved side effect when the requester disappears.

### 8. Input-side context growth and compaction

**What is missing.** Token-denominated bounds on the prompt. The memory recipes bound recall by counting messages and
characters, never tokens, and defer summarization indefinitely.

**Evidence.** Grep for `context window` across the entire reader surface returns ZERO. Recipe #04 budgets
OUTPUT tokens only (DIRECT_RESPONSE_MAX_TOKENS=384, DELIBERATE_RESPONSE_MAX_TOKENS=700). #05
bounds by `max_messages_per_thread = 12`, `recent = history[-6:]` and `item['content'][:800]` —
counts and characters — while telling the reader to add summarization 'once long threads exceed
the prompt budget' without ever defining that budget. #06 bounds by `LONG_TERM_MEMORY_LIMIT=5`
memories with no length cap per row. Both defer the fix: 'Add summarization once thread state
grows beyond the context budget.' #02's stated motivation is that classic RAG 'burns tokens',
yet it never bounds retrieved context.

**Why it matters.** The two recipes whose entire purpose is accumulating context are the two with no token-
denominated limit on it. Character and message caps do not map to tokens, so the reader's
ceiling is unknown until a request fails or silently truncates in the provider. This is also
where prompt caching would pay — a stable thread prefix is precisely the cacheable shape — and
the corpus never connects the two.

**What a recipe covering it would have to demonstrate.** Measure the real prompt in tokens per turn, show the growth curve across a long thread, trigger
compaction on a token threshold rather than a message count, and show what the summarization
step loses. Pair it with cache-hit rate to show a stable prefix paying for itself.

### 9. Model migration, deprecation, and swap safety ★

**What is missing.** Any guidance on changing the model. Every recipe hardcodes one, and nothing covers what to do
when it changes, degrades, or is retired.

**Evidence.** Grep for `deprecat` and `model version` across the entire reader surface returns ZERO. Recipes
#01 and #04 pin `meta-llama/Llama-3.3-70B-Instruct` in recipe.json, #02/#03 additionally pin
`Qwen/Qwen3-Embedding-8B`, and the config tables document `NEBIUS_MODEL` only as 'Chat model for
progress and synthesis'. #02 comes closest by accident, noting older vectors 'need to be
upserted again before explicit theme filtering can work', but gives no backfill or re-embedding
procedure. Sentinel offers partial coverage — it compares three model tiers on
quality/cost/latency and fails fast on an unknown NEBIUS_MODEL value — but that is model CHOICE,
not model CHANGE.

**Why it matters.** Hosted model ids get retired and silently re-pointed on a timescale shorter than the life of the
code a reader ships from these recipes. An embedding-model change is worse than a chat-model
change because it invalidates the whole index and the corpus has no re-embedding path. And with
recipe 10 unbuilt, the reader has no eval to detect that a swap made things worse — this gap and
the evaluation gap compound.

**What a recipe covering it would have to demonstrate.** Swap a chat model behind a stable config seam and diff behaviour on a fixed eval set; re-embed
and backfill an index on an embedding-model change while serving from the old vectors; and show
the shape-reliability check from the structured-output gap gating the swap alongside the
accuracy check.

### 10. Identity and multi-tenancy are deferred by every single recipe

**What is missing.** An implemented authentication and tenant-isolation boundary. Every recipe that needs identity
takes it from the request body and tells the reader to fix it in production.

**Evidence.** Grep for `tenant` across the entire reader surface returns ZERO. Recipe #01 files auth under
Going Further ('Drop a JWT verifier in as a FastAPI Depends') and its rate-limit advice assumes
auth is absent ('raise RATE_LIMIT_REQUESTS_PER_DAY only behind authentication'). #05: 'Derive
thread_id from an authenticated session rather than trusting arbitrary client input.' #06 is
explicit — 'The request body includes user_id because this cookbook has no auth layer' — and its
failure table lists 'Memory leaks between users | Client-controlled user_id in a real app'. #07
carries the same user_id into trace metadata. #09 defers 'Persist approvals in Postgres with
row-level ownership by authenticated user.' Sentinel gates its UI with a single shared
UI_API_KEY, which is access control but not per-user identity.

**Why it matters.** The corpus builds durable per-user memory (#06), user-attributed traces (#07) and payment
approvals (#09) all keyed on an identifier the client supplies and the server never verifies.
Each recipe's deferral is individually reasonable; the cumulative effect is that the most
sensitive artefacts in the arc — stored personal facts, and authority to create a checkout —
rest on an unauthenticated string. The reader is left to retrofit identity across five recipes
at once.

**What a recipe covering it would have to demonstrate.** Verify a token once and derive thread_id, user_id and approval ownership from it, ignoring
anything the client sends; enforce isolation at the storage layer so a bug in app code cannot
cross tenants; and show a cross-tenant read being refused by the database rather than by
application logic.

### 11. Idempotency and replay safety of retried side-effecting calls

**What is missing.** Explicit reasoning about whether a retried call is safe to repeat. Retries are implemented in
several places; replay safety is discussed in none of them.

**Evidence.** WEAKEST of the listed gaps — recipe #09 does test 'idempotent completed approvals' and is the
only `idempot` hit in the reader surface, though the README never explains the property.
Elsewhere: #01 wraps a streaming POST in tenacity with `stop_after_attempt(3)` and correctly
limits retries to transport errors, but never asks whether tokens already emitted to the client
make a replay unsafe. Sentinel retries per SOP 'up to 4 attempts with backoff' with no dedup
discussion. #02's bulk-embedding path has no retry story at all and never states whether re-
running a crashed ingest is safe. Grep for `idempot` returns only 09.

**Why it matters.** Retry is the corpus's default answer to transient failure, and it is applied to a streaming call
that has already emitted partial output, to an ingest that only upserts, and — one recipe away —
to a payment action. Whether repetition is safe is a per-call property that the reader is never
prompted to determine, and getting it wrong produces duplicates rather than errors.

**What a recipe covering it would have to demonstrate.** Classify calls as safe-to-replay or not, carry an idempotency key through the side-effecting
path, show a duplicated action when the key is dropped, and show resumable ingest that can crash
and re-run without double-writing.

★ marks a gap this repository has production evidence for, in [`evals/data/decisions.json`](../evals/data/decisions.json).

## What the corpus covers well

Listed so it does not get re-derived. Several of these are better than anything in this
repository, and a competing cookbook should extend them rather than repeat them.

- SSE streaming as a production transport (#01) — named events (status/token/done/heartbeat/error)
  instead of raw text, a 15s heartbeat because load balancers kill idle streams, `x-accel-
  buffering: no` so nginx stops buffering, and a disconnect watcher that cancels upstream
  generation so a closed tab does not cost a full generation. This is unusually complete and
  rarely written down; do not duplicate.
- HTTP client discipline against a model provider (#01) — split connect (5s) vs read (60s)
  timeouts with the reasoning for why one global value is wrong; retry policy owned in exactly ONE
  layer (`max_retries=0` on the SDK, tenacity above it) with the warning that two stacked retry
  layers is an incident waiting to happen; retries on transport errors only, never 4xx or content
  errors; and a process-wide singleton client so the TLS handshake and connection pool survive.
- Prometheus metric design that will not melt the instance (#01) — labelling on the route template
  `/agent/run` rather than the raw URL, with the explicit warning that high-cardinality per-user
  or per-ID labels are the fastest way to kill Prometheus. Also the ASGI middleware-ordering-is-
  load-bearing point.
- Human-in-the-loop approval for an irreversible external action (#09) — the full pattern 'model
  proposes action → backend validates policy → user approves → MCP tool executes', with approval
  TTL, an explicit reject path that makes no Stripe call, operator-seed key separated from
  restricted runtime key, sandbox isolation, and the line 'Do not let tool discovery become tool
  authority.' Genuinely strong; a competitor should extend it to delegation rather than redo it.
- Layered guardrails with fail-closed behaviour (#08) — cheap deterministic marker checks BEFORE
  any model call, with the explicit note that marker lists are not LLM instructions and an LLM
  classifier belongs only after the deterministic layer; buffering generated output and validating
  it before emitting rather than streaming unsafe tokens; PII handled by redaction rather than
  rejection, redacted before both storage and the model call; and `guardrail_events_total` per
  rule and outcome so a bypassed policy shows up as flat metrics.
- Trace shape for an agent run (#07) — a named span per meaningful stage (memory recall, routing,
  prompt render, model stream, persistence), reducers so streamed chunks are summarised rather
  than stored token-by-token, redacted prompt/output previews, and the important architectural
  rule that tracing failures must not break the response because observability should never become
  an availability dependency. Plus the Prometheus-for-aggregates / traces-for-single-runs division
  of labour.
- Memory as a two-key model with privacy as product surface (#05/#06) — `thread_id` for
  conversation continuity and `user_id` for durable namespace; bounded recall as a stated design
  rule; write-after-success so failed runs do not poison future context; and list/summary/delete
  endpoints framed as 'privacy workflows are product behavior, not admin utilities' with deletion
  paths kept under test.
- Operational packaging conventions (#01, #06-#10, docs/) — Pydantic Settings validated at boot so
  a bad config fails at startup; multi-stage Docker on a slim non-root image with a healthcheck
  wired to /healthz; /healthz vs /readyz where readiness reflects DATA state (#02: not-ready until
  artifacts are compiled); and one Postgres shared across cookbooks via an ENV-derived schema
  (`dev_cbk_07` / `prod_cbk_07`) rather than separate databases.
- Network-free testing as a house standard (every recipe) — respx mocks for Nebius, Pinecone,
  Tavily, Stripe REST and Stripe MCP, so CI passes offline and the test suite doubles as a
  runnable spec of the SSE contract. Consistently applied across all ten recipes.
- Ingest pipeline engineering (#02) — the write-time/read-time split so recompilation never
  touches request latency; embedding batch size decoupled from index-write batch size (100 vs 200)
  with the reasoning; pipelining embeds against upserts with concurrency and a pending-batch cap
  as separate throughput and memory levers; an analysis-only dry run before spending money; and
  the point that one-request-per-record is a debug tool, not an ingestion setting.
- Ground-truth evaluation METHOD in the Sentinel blueprint — 420 labelled (SOP, regulation) pairs,
  per-class precision/recall/F1 rather than one aggregate, false-positive vs false-negative split,
  a 'failed %' bucket for pairs missing from output, per-regulation breakdown, and a revised
  matrix documenting 16 corrections after manual review. The method is sound and should not be re-
  derived — but note it lives only in the blueprint, so the gap is packaging it as a teachable
  recipe, not inventing it.
- Two-source grounding with separated provenance (#03) — static index for semantic recall plus
  live search for what changed, with distinct citation namespaces ([1] vs [W1]) so the reader can
  see which claims are fresh, the live query built from retrieval output rather than the raw
  prompt, and live search scoped to freshness-only claims instead of general retrieval.

## Method

One agent per cookbook and one for the blueprint, each reading the full README and recipe
metadata and reporting what it teaches, what it declares out of scope, every row of its failure-
modes table, and any observed measurement it publishes. Absence was only recorded after a
keyword search, and the keywords are named in the evidence. A synthesis pass then ranked the
gaps by how badly a production reader is hurt, with instructions that a false gap is more
expensive than a missed one.

