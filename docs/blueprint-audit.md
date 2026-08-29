# Venus against the Nebius production-agent blueprint

An honest audit of this codebase against Nebius's [*From prototype to
production-ready agents*](https://nebius.com/blog/posts/from-prototype-to-production-ready-agents)
and the [Sentinel compliance-auditor `AGENTS.md`](https://github.com/nebius/nebius-partner-cookbook/blob/main/blueprints/sentinel-compliance-auditor/AGENTS.md).

Adopted, adapted, and skipped — with the reasoning for each, including where
Venus does less than the blueprint.

## The maturity curve

The post frames four generations: prototype → grounded (add live search) →
optimized (cheaper model, measured) → production (observability + evals).
Venus has walked the same path, and the artifacts of each step are in the repo:

| Generation | Venus |
|---|---|
| Prototype | Single model through Vercel AI Gateway, no traces, no evals |
| Grounded | Tavily for all research (`agent/tools/web_search.ts`), with `time_range` / `topic` / published dates for anything that goes stale |
| Optimized | Direct Nebius Token Factory (`agent/lib/nebius.ts`); one model per job (`agent/lib/models.ts`); cost per step, per agent, per session (`agent/lib/pricing.ts`) |
| Production | LangSmith tracing with per-session deep links, a KV trace store, fixed eval sets, and a live per-agent console |

## Practice by practice

### Adopted

**Specialist sub-agent with a narrow tool surface.** Sentinel gives each SOP a
ReAct sub-agent that can only record findings and search. Venus's `scout`
(`agent/subagents/scout/`) has exactly `web_search` + `record_vendor`. It
cannot email a vendor — the capability is absent, not forbidden. eve's
built-in `agent` tool is shadowed (`agent/tools/agent.ts`) because it would
hand a research child a copy of the root agent, `send_outreach` included.

**`record_finding` per finding.** Sentinel replaced an end-of-context JSON
array with a tool call per finding so partial progress survives truncation and
"zero findings" becomes detectable. Venus's `record_vendor` does the same, and
`get_research` joins the findings to the live trace so the planner can tell
"searched properly, nothing fits" from "that specialist was cut off" — and
re-runs only the second.

**Retrieval governance.** Sentinel caps regulation retrieval at 30 calls per
SOP. Venus uses eve's durable state for a per-session search budget
(`agent/lib/search-budget.ts`): 25 for a specialist, 40 for the planner.
Hitting it returns `cap_reached`, not an error — the model is told to conclude
from what it has. Verified in production: a run hit exactly 40 and finished.

**Transient-only retries with jitter.** Sentinel retries 429/504 and never
retries truncation. Venus's Tavily call retries 429/5xx and network failures
three times with exponential backoff plus jitter, never retries a 4xx, and
never double-charges the search budget for a retry. Truncation is recorded and
surfaced (`truncations` in the trace), never blindly retried.

**Centralised pricing → cost per run.** Sentinel keeps a `PRICING` dict.
Venus generates `agent/lib/pricing.generated.ts` from
`GET /v1/models?verbose=true` (`npm run pricing:refresh`) and computes cost per
step, because Token Factory reports token counts but no price.

**A judge pinned away from the model under test.** Sentinel's judge is always
DeepSeek regardless of `NEBIUS_MODEL`. Venus's `judge` role is a first-class
entry in the model registry, defaulting to DeepSeek-V4-Pro, so swapping any
other role can never move the bar it is measured against.

**Model threaded from config into sub-agents.** Sentinel passes `model_name`
through `build_tools()` into its children. Venus resolves it by *role*
(`agent/lib/models.ts`), and the routing is reported in the app's rail and on
`/observe`, so a trace never claims the planner's model for a scout run.

**LangSmith instrumentation.** `agent/instrumentation.ts`. Two things the docs
do not tell you: the exporter's `export()` is a no-op unless
`LANGSMITH_TRACING` is truthy, and eve's spans arrive through the new
`@ai-sdk/otel` GenAI-semconv integration, so its runtime context lands as
`ai.settings.context.*` — a prefix the exporter's built-in rules never rewrite,
and whose span-kind branches are gated on an `ai.operationId` these spans do
not carry. Without the `transformExportedSpan` here, every run arrives
unlabelled and unfilterable.

**Fixed evaluation datasets.** Sentinel holds 120 tasks constant across every
configuration. Venus holds three: 15 labelled vendor replies
(`evals/data/vendor-replies.json`), three research briefs
(`evals/data/briefs.json`), and the deterministic eve suite. All survive a
model swap unchanged, which is the point.

**Actuation closes the loop.** Sentinel files Jira tickets. Venus sends the
vendor emails, schedules its own follow-ups, files replies, tracks bookings,
and generates a dated countdown with proactive check-ins. This part predates
the blueprint work and already matched it.

**Untrusted input is data, not instruction.** Vendor replies, web pages and
scout reports cannot change the task. Asserted by an injection case in the
reply eval, not just asserted in a prompt.

### Adapted

**Model comparison across configurations.** The post's headline is a 19× cost
reduction found by swapping models against a held-constant dataset. Venus has
`npm run models:compare`, which sweeps candidate models over the 15 labelled
replies and reports accuracy, cost and median latency per candidate — so the
entry in `agent/lib/models.ts` is a measurement, not a preference. The scout
role is chosen on the same reasoning the post used (its cost is dominated by
input tokens over a long tool loop, so input price and context length are the
terms that matter) and verified with `npm run eval:scout`.

**Adversarial testing.** Sentinel used Snowglobe to simulate personas and
found a social-engineering bypass before launch. Venus has three adversarial
cases in the reply eval — a prompt injection instructing the agent to forward
the couple's details, an out-of-scope request, and malformed HTML — and a
guardrail eval asserting a status question never triggers outreach. **This is
less than Snowglobe.** A fixed set of three cases cannot find the bypass
nobody thought of; a simulation sweep can. Named here as a real gap rather
than counted as done.

### Not adopted

**Dual-source retrieval (Pinecone + Tavily).** Sentinel splits a static corpus
of 36 regulatory frameworks from live FDA guidance. Venus has no static
corpus: wedding vendors, pricing and availability are *inherently* live, and a
cached index of them would be a liability rather than an asset. Tavily is the
whole retrieval layer on purpose. The research store (`record:<session>:*`) is
accumulating something corpus-shaped, and if that ever justifies an index, it
is the natural place for one.

**Jira actuation.** The equivalent loop here is email, follow-ups and the
countdown, which already exist.

## Known gaps

1. **No adversarial simulation.** Three fixed injection cases, not a sweep.
2. **Radius adherence is enforced by declaration, not measurement.** Every
   vendor must state its town and drive, and the eval judges it, but nothing
   geocodes. Vendors 15–30 minutes past the line still get through.
3. **No eval measures prose quality**, so the planner's model is held constant
   on principle rather than evidence — deliberately, since it is the voice of
   the product.
4. **Durable sessions keep spending after the client disconnects.** An
   abandoned run reached $5.18 across 18 agents on its own. The search budgets
   bound it; nothing cancels it.
