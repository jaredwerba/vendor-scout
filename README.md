# Venus — a production agent that happens to plan weddings

An agentic wedding planner on [eve](https://vercel.com/eve) + Next.js, built as a demonstration
of how a real agent system is engineered: a narrow-tool specialist tier, incremental result
recording, retrieval budgets, per-agent live observability, token/cost accounting, and fixed
eval sets with a separately-pinned judge.

One conversation in, a fully executed wedding out: parallel vendor research, three costed
visions with real venue photography, autonomous outreach in the couple's voice, reply
understanding, automatic follow-ups, decision tracking, and a proactive countdown to the day.

Live: **https://vendor-scout-xi.vercel.app** — public, no sign-in.

## The journey

1. **Front door** (`/`): budget slider → "Begin with Venus". Public — no access code, no
   sign-in, no email field. The observability rail is visible from the first paint.
2. **Interview**: one signature question + an explicit checklist; complete brief = zero follow-ups.
3. **Research**: one `scout` specialist per category, fanned out in parallel, each with its own
   session, its own lane in the rail, and its own tool budget.
4. **Three visions**: Ultra-Luxe / Elevated / Intimate & Beautiful — real venues with photo
   carousels, full financial tables, all within budget. Tier-tap gate with prices on buttons.
5. **Execution**: autonomous emails to real vendors (reply-to = the couple), automatic double
   follow-up, bounce/complaint handling, model-classified replies with couple notifications.
6. **My Wedding** (`/my-wedding`): booked ✓ / your-move / in-flight lanes + **The Countdown** —
   a Venus-generated dated milestone plan with daily proactive email check-ins.
7. **Curated by Venus** (`/curated`): every plan archived — photos, budgets, full research.

## The engineering half

| Concern | How it is handled | Where |
|---|---|---|
| Specialist isolation | `scout` is a **declared subagent** whose entire tool surface is web search + `record_vendor`. It cannot email anyone — the capability is absent, not forbidden. | `agent/subagents/scout/` |
| Partial progress | Each vendor is recorded the moment it is verified, not returned in one closing blob. A truncated run keeps everything already found, and "recorded 0" is a **detectable failure**. | `agent/lib/research.ts`, `tools/record_vendor.ts` |
| Failure visibility | `get_research` joins findings to the live trace, so the planner can tell "searched properly, nothing fits" from "that specialist was cut off" and re-runs the second. | `agent/tools/get_research.ts` |
| Retrieval governance | Durable per-session search budget: 25 for a specialist, 40 for the root. Hitting it returns `cap_reached`, not an error. | `agent/lib/search-budget.ts` |
| Cost accounting | `includeUsage: true` plus a Token Factory price table → real per-step, per-agent, per-session dollars. | `agent/lib/pricing.ts` |
| Live observability | One lane per agent. The browser attaches directly to **each specialist's own session stream** (`/eve/v1/session/:id/stream`), because eve's parent stream carries only `subagent.called` and the final result. | `app/_components/use-agent-lanes.ts`, `observability-rail.tsx` |
| Durable traces | An observe-only hook folds every event of every session into KV, linked child → root. Redacted at write time: no message text, ever. | `agent/hooks/observe.ts`, `agent/lib/trace.ts` |
| Deep traces | OTel spans → LangSmith, with a `transformExportedSpan` that maps eve's runtime context onto LangSmith metadata and span kinds (the built-in rules do not fire for eve's span names). | `agent/instrumentation.ts` |
| Untrusted input | Vendor replies, web pages and scout reports are data, never instruction — asserted by injection cases in the reply eval. | `agent/lib/classify.ts`, `evals/data/vendor-replies.json` |
| Evals | Fixed datasets, held constant across model swaps, with the **judge pinned away from the model under test**. | `evals/`, `scripts/eval-*.ts` |

An honest audit against the blueprint — adopted, adapted, skipped, and the
gaps that remain — is in [`docs/blueprint-audit.md`](docs/blueprint-audit.md).

## Model routing

One model per job, each chosen for what that job actually demands
(`agent/lib/models.ts`), every one overridable by env:

| Job | Model | Why |
|---|---|---|
| `planner` | Qwen3-235B-A22B-Instruct | Venus's voice and orchestration. ~15% of cost, 100% of what the couple reads. Held constant until an eval can measure the swap. |
| `scout` | DeepSeek-V4-Flash | Cost is dominated by input tokens over 20–40 steps: $0.14/$0.28 vs $0.20/$0.60, and a 1M window vs 262k. |
| `classifier` | DeepSeek-V4-Flash | Measured: 15/15 at $0.13 per 1k replies, tied on accuracy with Qwen3-235B and 16% cheaper (`npm run models:compare`). |
| `judge` | DeepSeek-V4-Pro | Pinned away from every other role so a model swap can never move the bar. |

## Architecture

- `agent/` — the brain. `instructions.md` (persona + flow), `tools/` (one file per capability),
  `subagents/scout/` (the research specialist), `hooks/observe.ts` (trace store),
  `instrumentation.ts` (LangSmith), `schedules/` (daily crons: `followup-sweep`,
  `milestone-sweep`), `channels/inbound-email.ts` (svix-verified Resend webhook),
  `lib/` (roster, timeline, curated, classify, resend, research, trace, pricing, actions).
- `app/` — Next.js UI mounted beside the agent via `withEve`. Two panes on desktop: the
  conversation, and the permanent observability rail. `/observe` is the standalone console for
  any session; `/api/observe/*` serves the trace tree. No auth — Venus is public; a KV-backed
  daily request cap in `agent/channels/eve.ts` is the only throttle.
- Storage: Upstash KV (`outreach:*`, `timeline:*`, `curated:*`, `trace:*`, `record:*`).
  Email: Resend. Search: Tavily. Models: **Nebius Token Factory** (OpenAI-compatible
  `https://api.tokenfactory.nebius.com/v1`, not Vercel AI Gateway, not Nebius AI Cloud).

## Env (production + `.env.local`)

`NEBIUS_API_KEY`, `NEBIUS_MODEL` (default `Qwen/Qwen3-235B-A22B-Instruct-2507`),
`NEBIUS_SCOUT_MODEL` (optional — swap the specialist's brain in one line),
`NEBIUS_JUDGE_MODEL` (default `deepseek-ai/DeepSeek-V4-Pro`),
`LANGSMITH_API_KEY` + **`LANGSMITH_TRACING=true`** (the exporter silently drops every span
without the second) + `LANGSMITH_PROJECT`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
`OUTREACH_MODE` (dry_run|test|live), `OUTREACH_FROM`, `OUTREACH_TEST_INBOX`,
`COUPLE_NOTIFY_EMAIL`, `OUTREACH_REPLY_ADDRESS` (optional), `TAVILY_API_KEY`, KV vars
(auto-injected by the Upstash integration).

## Develop & test

```bash
npm run verify                           # typecheck + next build + eve build + guard tests
npm exec -- eve dev --no-ui --port 3111  # agent + API locally

npm run eval                             # fast deterministic suite (eve evals)
npm run eval:replies                     # 15 labelled vendor replies + injection cases
npm run eval:scout                       # research quality, end to end (slow, real credits)
npm run eval:all                         # replies + scout + fast suite
npm run eval:slow                        # budget discipline over a full planning turn
npm run eval:report                      # push suite results to KV → /observe
npm run pricing:refresh                  # regenerate the Token Factory price table
```

Deploys: push to `main` auto-deploys production (git-connected) — `vercel deploy --prod --yes`
for immediate. Safety invariants: outreach only from the main conversation, specialists have no
send capability, per-vendor caps, honest send statuses, svix-verified webhooks, no invented
vendors, no fabricated imagery, nothing the couple typed in the trace store.
