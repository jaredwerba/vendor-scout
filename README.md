# Venus — your wedding, planned

An agentic wedding planner on [eve](https://vercel.com/eve) + Next.js. One conversation in,
a fully executed wedding out: parallel vendor research, three costed visions with real venue
photography, autonomous outreach in the couple's voice, reply understanding, automatic
follow-ups, decision tracking, and a proactive countdown to the day itself.

## The journey

1. **Front door** (`/`): budget slider → "Begin with Venus". Public — no access code, no
   sign-in, no email field; anyone with the link can plan.
2. **Interview**: one signature question + an explicit checklist; complete brief = zero follow-ups.
3. **Research**: parallel specialist agents (venue · photography · catering · styling), live
   progress bars.
4. **Three visions**: Ultra-Luxe / Elevated / Intimate & Beautiful — real venues with photo
   carousels, full financial tables, all within budget. Tier-tap gate with prices on buttons.
5. **Execution**: autonomous emails to real vendors (reply-to = the couple), automatic double
   follow-up, bounce/complaint handling, model-classified replies with couple notifications.
6. **My Wedding** (`/my-wedding`): booked ✓ / your-move / in-flight lanes + **The Countdown** —
   a Venus-generated dated milestone plan with daily proactive email check-ins.
7. **Curated by Venus** (`/curated`): every plan archived — photos, budgets, full research.

## Architecture

- `agent/` — the brain. `instructions.md` (persona + flow), `tools/` (one file per capability),
  `schedules/` (daily crons: `followup-sweep`, `milestone-sweep`), `channels/inbound-email.ts`
  (svix-verified Resend webhook), `lib/` (roster, timeline, curated, classify, resend).
- `app/` — Next.js UI mounted beside the agent via `withEve`. No auth — Venus is public; a
  KV-backed daily request cap in `agent/channels/eve.ts` is the only throttle. Session resume
  via localStorage, liquid-glass composer with a Siri ring while Venus works.
- Storage: Upstash KV (`outreach:*`, `timeline:*`, `curated:*`). Email: Resend (send + inbound
  webhook). Search: Tavily (`include_images` for venue photos). Models: Vercel AI Gateway.

## Env (all three Vercel environments + `.env.local`)

`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `OUTREACH_MODE` (dry_run|test|live),
`OUTREACH_FROM`, `OUTREACH_TEST_INBOX`, `COUPLE_NOTIFY_EMAIL`, `OUTREACH_REPLY_ADDRESS`
(optional), `TAVILY_API_KEY`, KV vars (auto-injected by the Upstash integration).

## Develop & test

```bash
npm run typecheck && npm run build       # gates every deploy
npm exec -- eve dev --no-ui --port 3111  # agent + API locally
node --env-file=.env.local scripts/test-timeline.mjs   # Countdown store contract
curl -X POST localhost:3111/eve/v1/dev/schedules/milestone-sweep  # fire a cron once (dev only)
```

Deploys: push to `main` auto-deploys production (git-connected) — `vercel deploy --prod --yes`
for immediate. Safety invariants: outreach only from the main conversation, per-vendor caps,
honest send statuses, svix-verified webhooks, no invented vendors, no fabricated imagery.
