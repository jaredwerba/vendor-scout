# What the Nebius Agents Blueprint actually is

Research notes, August 2026. Written before designing Approach B so the design
answers the real thing rather than the marketing surface.

## The six layers, and which are real

| Layer | Product | Runnable Nebius code? |
|---|---|---|
| Inference / runtime | Nebius Token Factory | Yes — "the agent runtime; every other component plugs in around it" |
| Orchestration | LangChain Deep Agents | Yes |
| Observability | LangSmith | Yes |
| Grounding | Tavily **by Nebius** | Yes |
| Knowledge | Pinecone + Nexus | Pinecone yes; **Nexus appears in zero lines** |
| Simulation | Snowglobe by Guardrails AI | **Zero lines** |

Two of six layers exist only in the marketing. The four that are real are the
four worth studying.

**Tavily is owned, not partnered.** Nebius agreed to acquire it in February
2026; it keeps its brand and provider-neutral positioning. Venus already runs
its entire retrieval layer on Tavily, which turns out to be on-blueprint by
accident rather than design.

**Pinecone Nexus "compiles task-specific knowledge artifacts at index time, so
agents work from prepared context instead of assembling it at query time,"
with plain vector search as the retrieval primitive underneath.** That is
precisely the shape of the gap in Venus: 123 verified vendors sitting in
per-session keys, re-derived from scratch every plan.

## The thesis

> "A 95% success rate at each step becomes roughly 60% task completion across
> a ten-step workflow."

> "We did not post-train DeepSeek or Nemotron. Instead, we improved the system
> around them — better retrieval architecture, better orchestration, better
> evaluation — and that's where the performance came from."

> "The open model wasn't the limiting factor. The system around it was."

Every Nebius asset restates it: the harness is the quality lever, the model is
a line of configuration. Venus's own measurements say the same thing
independently — every quality gain came from harness work (tool-level guards,
incremental recording, deleting a brittle `outputSchema`), and the one model
swap attempted for economics failed 10 of 10 specialist sessions.

## Caution: the published numbers do not reconcile

Worth stating plainly, because a comparison that cites them as fact inherits
their problems.

- **72% vs 82% lower cost.** The blog, the case study and dev.nebius.com say
  72% lower cost / 20% higher precision; nebius.com/solutions/ai-agents says
  82% average lower cost and "5× cheaper than GPT-5-class". Nothing
  reconciles them.
- **The headline 1.00 recall / 0.91 precision / $7.93 matches no committed
  artifact** in the blueprint repo.
- **Token Factory's public per-token pricing is not retrievable** — both price
  pages 404 and the live list is login-gated. The only verifiable prices are
  the blueprint's own hardcoded `PRICING` dict, which is an author's constant,
  not a rate card. (Venus generates its table from
  `GET /v1/models?verbose=true`, which *is* primary.)
- The README's "full audit" costs and the blog's FDA-subset costs describe
  different task scopes; neither page says so.

The engineering in Sentinel is genuinely good and unusually candid about the
production failures that shaped it. The metrics on top of it are not
citable. Approach B should reproduce the *patterns* and generate its own
numbers.

## Patterns worth copying

Confirmed in Sentinel's source: `record_finding` per finding, per-item
retrieval caps, a stall guard, connection pooling, and trace re-parenting so a
sub-agent's spans land under the run that spawned it.

Venus already arrived independently at the first two and at trace
re-parenting. The stall guard and connection pooling are new.
