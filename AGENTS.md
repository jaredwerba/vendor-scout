# AGENTS.md — Venus

## What this project is

Venus is a production wedding-planning agent: a root planner that fans out research specialists,
verifies what they find, emails real vendors, files their replies, and reports what it spent. It
runs live at [vendor-scout-xi.vercel.app](https://vendor-scout-xi.vercel.app) with
`OUTREACH_MODE=live`, so a mistake reaches a stranger.

It is built on the **eve** framework. Before writing code, read the relevant guide from the
installed eve package docs — usually `node_modules/eve/docs/`. In a workspace or local package
install, resolve the installed `eve` package location first and read its `docs/` directory. If
package docs are unavailable, use https://eve.dev/docs.

The engineering half is deliberate: the app is also the artifact. See
[`cookbook/`](./cookbook/) for the ten recipes extracted from what went wrong here, and
[`blueprint.json`](./blueprint.json) for the machine-readable descriptor.

## Quick reference

```bash
npm run verify           # typecheck + next build + eve build + guard/outcome/fold tests
npm run dev              # Next dev server
npm exec -- eve dev --no-ui --port 3111
npm run eval:all         # guards + labelled replies + adversarial sim + scout + fast suite
npm run models:compare   # sweep classifier candidates over the labelled set, 3 rounds
npm run probe:schema     # structured-output reliability, 30 calls per model
npm run report           # the evidence pack: reliability, cost tails, generations
npm run pricing:refresh  # regenerate the Token Factory price table from the live catalog
node scripts/build-cookbook-readme.mjs --check   # cookbook catalog has not drifted
```

Push to `main` auto-deploys production.

## Architecture

### The two agents

`agent/agent.ts` is the root planner — the couple's voice, the orchestrator, and the only thing
that can send email. `agent/subagents/scout/` is the research specialist: its entire tool surface
is `web_search` plus `record_vendor`. It cannot contact anyone, because the capability is absent
rather than forbidden.

eve's built-in `agent` tool is **shadowed** by an authored refusal at `agent/tools/agent.ts`. The
built-in delegates to a copy of the ROOT agent, which would hand a research child `send_outreach`.
`disableTool()` cannot suppress a built-in, so the refusal is authored.

### Fan-out

The planner dispatches at most five `scout` calls in a single response, one per category. eve runs
the batch concurrently and returns every result before the root continues, so a turn's wall clock
is the slowest specialist, not the sum. A specialist that goes silent is reported as `stalled` by
`get_research` after five minutes and the planner is told not to wait for it.

### Findings

Specialists never return findings in their reply. `record_vendor` writes each one to KV the moment
it is verified, and `get_research` joins those to the live trace so the planner can tell a
truncated specialist from a genuinely empty category — and re-runs only the first.

## Key modules

| Path | What it owns |
|---|---|
| `agent/lib/models.ts` | The per-role model registry (planner / scout / classifier / judge) and `assertKnownModel` |
| `agent/lib/pricing.ts` | Cost from tokens; the cached-token rule that `prompt_tokens` already includes `cached_tokens` |
| `agent/lib/pricing.generated.ts` | Token Factory catalog snapshot — generated, do not hand-edit |
| `agent/lib/vendor-guards.ts` | Directory hosts, foreign emails, dead sources — the record-time gate |
| `agent/lib/search-budget.ts` | Per-session retrieval caps, counted in queries |
| `agent/lib/trace.ts` | The KV trace store, redacted at write time, and the stall guard |
| `agent/lib/actions.ts` | The outcome taxonomy — success, refused, failed — shared by store and UI |
| `agent/lib/research.ts` | The per-session findings store `record_vendor` writes to |
| `agent/instrumentation.ts` | OTel → LangSmith, including the span-attribute mapping eve needs |
| `evals/data/decisions.json` | The dated record of what broke; generates `docs/engineering-log.md` |
| `evals/harness/` | The `RunResult` contract both architectures emit, so one grader scores both |

## Environment variables

`NEBIUS_API_KEY`, `NEBIUS_MODEL`, `NEBIUS_SCOUT_MODEL`, `NEBIUS_CLASSIFIER_MODEL`,
`NEBIUS_JUDGE_MODEL`, `TAVILY_API_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
`OUTREACH_MODE` (`dry_run|test|live`), `OUTREACH_FROM`, `OUTREACH_TEST_INBOX`,
`OUTREACH_REPLY_ADDRESS`, `COUPLE_NOTIFY_EMAIL`, `LANGSMITH_API_KEY`, `LANGSMITH_TRACING`,
`LANGSMITH_PROJECT`, plus the Upstash KV vars.

`LANGSMITH_TRACING=true` is required alongside the key. The exporter's `export()` is a no-op
without it, so tracing looks configured and ships nothing.

## Patterns to follow

- **A rule in the instructions is not a control.** If the model has already broken it, move it into
  the tool — but only where the tool can actually check it. A guard demanding a fact the tools
  cannot reach becomes a death spiral.
- **Record findings as they are found.** Never an end-of-context array. Partial progress must
  survive a truncation, and "zero findings" must be detectable.
- **No `outputSchema` on a tool-calling sub-agent.** Schema constraints plus tool calling make some
  open models stop calling tools, and eve escalates an unmet schema to a failed session.
- **Retry only transient faults, and classify from a status code, never from model prose.**
- **One retry layer.** The SDK is set to `max_retries: 0`; retry policy lives where it is visible.
- **Cost is recomputed from stored tokens on read**, so a pricing fix corrects history rather than
  only the future.
- **Every model id is checked against the price table** and an unknown id stops the process. A
  silent fallback publishes a false attribution rather than breaking a run.
- **Statuses are classified in `agent/lib/actions.ts`.** A new tool status must be added to one of
  the three sets or `npm run test:outcomes` fails — deliberately.
- **Verify against the deployed artifact.** `cmd | grep` verifies nothing: the exit status belongs
  to grep.
