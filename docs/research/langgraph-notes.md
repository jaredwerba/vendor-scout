# LangGraph, as of August 2026

Notes taken before building Approach B. Versions: `langgraph` 1.2.11,
`langchain` 1.3.18, `deepagents` 0.7.11, `langsmith` 0.11.2. LangChain 1.0
shipped 2025-10-22; there is no 2.0.

## The findings that change the design

**`Send` fan-out nests traces automatically.** Sentinel needed a manual
callback-manager copy because it fanned out over raw threads and LangChain's
trace context is `contextvars`-based. The Pregel engine propagates the parent
`RunnableConfig` explicitly, so each specialist appears nested under the
orchestrator with no trick. The caveat returns only if a specialist spawns its
own threads.

**A Next.js route handler will not survive the tab closing.** The run is tied
to the request and serverless timeouts kill 20–40-step specialists. Surviving
it needs a background run on an Agent Server — LangSmith Deployment (Plus,
$39/seat) or a self-hosted standalone server with your own Postgres and Redis.

This is the sharpest honest comparison point in the whole exercise: **eve
gives durable background execution, resumable sessions and cron for free, and
Venus already relies on all three.** Matching that on LangGraph is an
architecture decision with a bill attached, not a deployment detail.

**LangMem is dead.** 0.0.30, last released 2025-10-27, still pinned to
pre-1.0 `langchain-core`, absent from the docs index. Cross-session memory is
`BaseStore` — `PostgresStore` with an `index` block for semantic search. Blog
posts still recommend LangMem; the docs do not.

**Use `ChatOpenAI(base_url=...)` for Nebius, not `langchain-nebius`.** That
package is 0.1.3 from 2025-06-29 and pins the pre-1.0 line — a resolver hazard
against current `langchain-core`, and a thin wrapper over `langchain-openai`
anyway.

**Prompt caching will not apply.** Deep Agents auto-registers Anthropic and
Bedrock caching middleware; neither applies to an OpenAI-compatible Nebius
endpoint. Budget for a full prompt re-send on every one of 20–40 steps —
which is exactly why Venus's specialists cost what they do.

## The shape

```python
class OverallState(TypedDict):
    findings: Annotated[list[Finding], operator.add]   # fan-in happens here

def fan_out(state):
    return [Send("specialist", {"topic": t}) for t in state["subtopics"]]

builder.add_conditional_edges("plan", fan_out, ["specialist"])
builder.add_node("synthesize", synthesize, defer=True)   # wait for ALL branches
```

Ranked risks, per the research:

1. **Missing `defer=True`** — synthesis fires on the first specialist to
   finish. Silent, and produces plausible-looking wrong output. This is the
   single most likely bug in this design, and it is exactly the class of
   failure the engineering log is about.
2. Missing the `operator.add` reducer — `INVALID_CONCURRENT_GRAPH_UPDATE`.
   At least it is loud.
3. Assuming the tab-close problem away. See above.
4. Side effects before `interrupt()` — the node re-runs from the top on
   resume, so an email sent before the interrupt sends twice.

## Human-in-the-loop

`interrupt()` raises to signal, so it must never be wrapped in try/except, and
the node re-executes from the top on resume. Resume in-process with
`Command(resume=...)`; over HTTP by starting a run with `command=` instead of
`input=`. This is a genuine capability gain over Venus today, which sends
vendor emails after a tier tap with no preview of the text.

## Recommendation

**Raw LangGraph orchestrator, Deep Agents specialists.**

The orchestrator must be raw: the requirement is exactly five parallel
branches with deterministic fan-out and a `defer=True` fan-in. Deep Agents
delegates through a model-invoked `task` tool, so the LLM decides how many
children to spawn — the wrong control model for "fan out five, wait for all
five, synthesise."

The specialists are where Deep Agents earns its keep: `SummarizationMiddleware`
compacts at 85% of the window (20–40 steps will blow it), `FilesystemMiddleware`
+ `StoreBackend` is exactly "write findings incrementally to a store", and
`PatchToolCallsMiddleware` repairs dangling tool calls when a run resumes
after an interrupt.

## Two cost traps

- An online evaluator **auto-upgrades every trace it touches to extended
  retention**, and a thread-level rule upgrades every trace in the thread — so
  a 40-step run is 40 upgrades. The pricing page says extended is 1.5× base;
  the docs say 10×. Unresolved; check an invoice before enabling broadly.
- Cron scheduling is Plus+ only. Relevant if memory consolidation runs on a
  schedule.
