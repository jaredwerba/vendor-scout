# Sentinel: the patterns worth porting

Verified against live `main` of `nebius/nebius-partner-cookbook`,
`blueprints/sentinel-compliance-auditor/`, August 2026. Line numbers are from
that tree.

## Three assumptions I had wrong

**Sentinel does not use LangGraph `Send`.** A grep for `Send`, `asyncio` and
`gather` across the blueprint returns zero hits. Fan-out is a plain
`concurrent.futures.ThreadPoolExecutor`, because its sub-agents are not graph
nodes at all — they are stock ReAct agents (`langchain.agents.create_agent`)
instantiated *inside a tool call*. Only the outer agent gets the deepagents
harness.

**Sentinel does not checkpoint.** No checkpointer, no `thread_id`, no
interrupts. Durability of findings comes entirely from the `record_finding`
side-effect list plus LangSmith traces; persistence, when deployed, comes from
LangGraph Platform. That is a defensible choice for a batch auditor and a poor
one for a conversational planner someone walks away from mid-plan.

**Its sub-agent tracing needs a manual trick** that graph-level fan-out would
not. See below.

## 1. The stall guard

Not a per-item timeout — a global liveness watchdog. If *no* item completes
for 20 minutes, the fan-out declares the rest wedged and returns with what it
has.

```python
# tools.py L21-27
# If NO sub-agent completes for this long, the fan-out declares the remaining
# ones wedged and returns with what it has. Observed failure mode (2026-06-10
# Nemotron run): provider streams left in CLOSE_WAIT never raise, three hung
# workers held as_completed + executor shutdown hostage for 60+ minutes and
# the whole audit produced nothing. Healthy fan-outs complete a SOP every
# minute or two, so 20 minutes of total silence means wedged, not slow.
AUDIT_STALL_TIMEOUT_S = int(os.environ.get("AUDIT_STALL_TIMEOUT_S", "1200"))
```

Three details that are easy to miss and are the whole point:

- The executor is **not** a context manager. `with ThreadPoolExecutor(...)`
  calls `shutdown(wait=True)` on exit, which is exactly what hung. Construct
  it bare; `shutdown(wait=False, cancel_futures=True)` in a `finally`.
- `wait(..., FIRST_COMPLETED)` in a loop, not `as_completed(timeout=...)` —
  the latter raises and discards, losing completed work.
- `f.cancel()` cannot stop an already-running wedged thread. They accepted a
  thread leak to get the results back, and say so in the docstring. In a
  long-lived server that trade is worse than it was for their batch job.

The commit message is the artifact: the wedged run's findings were **salvaged
from the LangSmith trace** — 1,182 findings across 123 SOPs — because trace
propagation had landed five hours earlier that same day.

## 2. Connection pooling

One process-wide `httpx.Client`, shared by every worker, because per-worker
clients caused **DNS-exhaustion failures at 50 workers**. Double-checked
locking, lazy import, `max_connections=200`, `keepalive_expiry=120`, and a
`Timeout(600.0, connect=30.0)` shaped for long agent turns.

Only the LLM path is pooled. Pinecone uses module singletons plus an
`lru_cache` on the query; Tavily constructs a client **per tool call**. So the
pattern covers inference concurrency, not retrieval concurrency.

## 3. Trace re-parenting

LangChain's trace context is `contextvars`-based and dies at a thread
boundary, so sub-agents were **95%+ of a full audit's LLM calls, untraced**.

The fix is a *copy* of the parent's callback manager — the copy keeps
`parent_run_id` so the child nests, but gets fresh handler lists so one
worker's usage handler does not bleed into its siblings.

```python
callbacks = parent_callbacks.copy()          # NOT list(...) or reuse
callbacks.add_handler(usage_cb, inherit=True)
return {"recursion_limit": 120, "callbacks": callbacks}
```

Two consequences worth copying with it: the child model carries
`extra_metadata={"sentinel_subagent": True}` so scoring can **exclude child
runs from the parent's token sums** once re-parenting makes them appear in
both places; and `RunnableConfig` must be imported at module level, because
schema inference cannot resolve a stringized annotation from a function-local
import.

## 4. Smaller things that are obviously right

- **The item's text goes in the sub-agent's first message**, not behind a
  forced `read_sop` round trip: saves one LLM call per item and makes
  `system prompt + item` a stable prefix for provider-side prompt caching.
- **Token usage is accumulated in a callback** so counts survive an exception
  mid-run — tokens burned before a crash were still billed.
- **Retry classification never reads prose.** A structured `status` is set at
  each failure site, because model-written summaries contain words like
  "FAILED" and "rate" — there is a test feeding it *"must operate with
  accurate data"*, since "accurate" contains "rate".
- **No second retry layer.** Per-item retries only; stacking a batch-level
  retry on top multiplied to `MAX_RETRIES²` sub-agent runs per stubborn item.
- **Don't re-show retrieved chunks** the sub-agent has already seen: a ReAct
  transcript re-sends every prior turn, so a duplicate chunk is re-billed on
  every subsequent call.
- **Fail fast on a typo'd model id** — theirs used to fall back silently to
  DeepSeek, so you could benchmark the wrong model without noticing.

## The theme

Every post-mortem comment in that repo describes a **silent** failure: empty
judge verdicts returning -1 for 84 of 85 scores, a profile override that
no-op'd on a key mismatch, a recursion limit that quietly shrank the scored
sample, a wrong-model benchmark, sockets that hung without ever raising.

Nothing in their post-mortem set is a crash.

That is the same list Venus produced independently this month — costs
computing to $0 from a wrong field name, a delegation event the docs promise
and the runtime never emits, a page section that vanished only in production,
an `outputSchema` that killed ten of ten sessions, a dashboard reporting a
model that had been reverted hours earlier, an eval grading a run still in
flight.

**The failures that cost you are the ones that look like success.** That is
the thesis the comparison document should be built on, and it is the axis on
which the two architectures should be judged.

## Audit: what Sentinel does that Venus did not

Run against the code on 2026-08-29, not from memory.

| Pattern | Venus before | Now |
|---|---|---|
| `record_finding` per finding | yes (`record_vendor`) | — |
| Retrieval budget | yes (25 specialist / 40 root) | — |
| Item text in the first message | yes (brief inline) | — |
| Structured status, never prose, for retry | yes | — |
| Trace re-parenting | yes (`ctx.session.parent` lineage) | — |
| **Fail fast on a bad model id** | **no — silent fallback** | **added** |
| **Stall guard** | **no watchdog at all** | **added at the read** |
| **Suppress already-seen results** | **no — re-billed every step** | **added** |
| Connection pooling | no | not adopted, see below |
| Knowledge layer (Nexus) | no | still open |

### Fail fast on a bad model id

Sentinel's comment is exact: *"a typo'd NEBIUS_MODEL used to fall back
silently to DeepSeek, so you could benchmark the wrong model without
noticing."* Venus had the same fallback, and it is worse here, because every
number in the V1-to-V2 comparison is attributed to a named model. A silent
fallback would make those attributions quietly false — the same class as every
other fault in this project's log. An unknown id now stops the process and
names the near-misses.

### Stall guard, adapted rather than copied

Sentinel wraps its own `ThreadPoolExecutor`, because it owns the fan-out loop.
eve owns the loop here, so there is nothing to wrap. The intent — *one hung
worker must not hold the whole run hostage* — is enforced at the read instead:
`get_research` reports a specialist still marked active with no event for five
minutes as `stalled`, and the instructions tell the planner to proceed with
what it has. Same guarantee, different mechanism.

### Suppress already-seen results

*"The ReAct transcript re-sends every prior turn, so a duplicate chunk gets
re-billed on every subsequent LLM call."* A scout runs 20-40 steps over
overlapping queries, so this was real spend. `web_search` now drops results
the agent has already been shown and says how many it dropped.

### Connection pooling — deliberately not adopted

Sentinel shares one `httpx.Client` after DNS exhaustion at 50 concurrent
workers in one process. Venus's specialists are separate durable sessions
rather than threads in one process, and each scout's searches are sequential,
so the failure that motivated the pattern cannot occur in this shape.
Copying it would be cargo cult.

### The knowledge layer is the real remaining gap

Nexus "compiles task-specific knowledge artifacts at index time, so agents
work from prepared context instead of assembling it at query time." Venus has
123 verified vendors and re-researches every one of them for the next couple
in the same town. That is the largest single difference from the blueprint,
and it is architectural rather than a missing guard.
