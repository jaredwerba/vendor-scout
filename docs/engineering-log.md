# Engineering log

Every change that mattered, dated: what was wrong, why it was wrong, what changed, and what
happened as a result. Generated from `evals/data/decisions.json` — the same record the
console reads — so it cannot drift from the evidence.

The pattern worth noticing before reading it: **not one of these announced itself.** No
crashes, no stack traces, no red builds. Costs that were always zero. An event the
documentation promises and the runtime never sends. A page section present in development
and absent in production. A dashboard reporting a model that had been reverted hours
earlier. Ten of ten sub-agents dying inside a passing build.

The failures that cost the most are the ones that look like success.

## 2026-08-28

### Research children could email vendors

**Wrong.** Research was delegated with eve's built-in `agent` tool. Nothing looked wrong; the plans were good.

**Why.** The built-in runs a copy of the ROOT agent — same instructions, same tools, including `send_outreach`. The capability was inherited rather than granted, so a researcher was one bad inference away from emailing a stranger.

**Changed.** Made research a declared subagent (`agent/subagents/scout`) whose entire tool surface is web search plus `record_vendor`.

**Outcome.** The capability is absent rather than forbidden. A later run showed Venus still reaching for the built-in as well — 10 scout calls and 3 `agent` calls in one session — so the built-in was shadowed by an authored tool that refuses.

> A guarantee that depends on the model not using a tool it has is not a guarantee.

<sub>commits `93db25d`, `3f67cfb`</sub>

### A truncated specialist lost everything it had found

**Wrong.** A research child returned all its findings in one closing JSON blob.

**Why.** End-of-context arrays make every finding hostage to the last token. Worse, 'zero findings' was indistinguishable from 'nothing exists in this market'.

**Changed.** `record_vendor` writes each vendor to KV the moment it is verified; `get_research` joins the findings to the live trace so the planner can tell a truncated specialist from an empty one, and re-runs only the first.

**Outcome.** Partial progress survives, and a specialist that records nothing is a detectable failure. Measured later at 3-4 vendors per specialist with zero truncations.

> Write findings down as they are found, not at the end.

<sub>commits `93db25d` · runs `wrun_41M16NZKKB0GJNG65GT0HQ5BGW`</sub>

### Every cost computed to $0

**Wrong.** Token counts recorded correctly; every dollar figure was zero. Nothing errored.

**Why.** Two silent misses. eve reports the model as `RuntimeIdentity.modelId`, not `runtime.model`, so the trace never learned which model it was watching — and it prefixes that id with the provider it routed through (`token-factory/Qwen/...`) while the price table keys on the bare catalog id.

**Changed.** Read `modelId`; peel provider prefixes until one matches the table. Added `includeUsage: true`, without which streamed turns report zero tokens at all.

**Outcome.** Real per-step, per-agent, per-session cost. Across 28 traced sessions: median run $2.14, p90 $6.07, tail 2.8x median.

> A number that is always zero looks like a quiet system, not a broken one.

<sub>commits `5ddce55`</sub>

### The live view never attached, and reported zero specialists while five ran

**Wrong.** During a five-way fan-out the panel said 'specialists: 0', the browser never attached to a child stream, and the research eval decided nothing had been delegated and re-prompted twice.

**Why.** Three features were built on `subagent.called`, which the eve 0.24.4 documentation promises on the parent's durable stream and the runtime never emits. Only `subagent.completed` arrives.

**Changed.** Discover child sessions from the trace tree — each child writes its own summary linked by `ctx.session.parent` — and count delegations at `actions.requested`, where a subagent-call is actually visible.

**Outcome.** Lanes populate live. The eval stopped triple-running: one fan-out at ~$1.15 instead of three at $2.29 across 18 agents.

> Verify that the event you built on is actually emitted, not merely documented.

<sub>commits `0186cdf`</sub>

### A wedding inquiry addressed to a media company

**Wrong.** A caterer was recorded with the email `inquiries@hideseekmedia.com`, sourced from a WeddingWire page for a different business. Outreach runs live.

**Why.** The scout's instructions already forbade directory sources and required a published address. It did it anyway.

**Changed.** `record_vendor` refuses a source URL on any of 20 known directories, and an email whose domain shares nothing with the vendor's name or website. Free mail passes — a gmail address for a small florist proves nothing either way.

**Outcome.** Unit-tested against 12 real rows from that run: the three bad ones reject, all nine legitimate findings still pass. Every subsequent run: 100% own-site sources, zero foreign emails.

> When the model has already broken a written rule, repeating the rule is not a control. Move it into the tool — but only where the tool can actually check it.

<sub>commits `b01a1d6`, `425fa6a` · tests `npm run test:guards`</sub>

### A broken deploy, reported as verified

**Wrong.** Pushed a commit that failed every Vercel production build, and said it was verified.

**Why.** The build was checked with `npx eve build 2>&1 | grep -i error`. The failure message contained neither 'error' nor 'warn', and the pipe discarded the non-zero exit status.

**Changed.** `npm run verify` — typecheck, next build, eve build and the guard tests, chained with `&&` so any failure fails the command.

**Outcome.** No further broken deploys. Production never served the bad build.

> `cmd | grep` verifies nothing: the exit status belongs to grep.

<sub>commits `d0fac5b`, `f007753`</sub>

## 2026-08-29

### A cheaper classifier that fails 13% of its structured outputs

**Wrong.** A model sweep scored DeepSeek-V4-Flash 15/15 at 16% less cost, so the vendor-reply classifier was switched to it. The very next run of the same fifteen cases scored 11/15 with six schema failures.

**Why.** One pass over fifteen cases cannot separate two models near the top; it can only rule out the clearly worse. And an accuracy sweep is structurally blind to schema failure — a call that never returns an object is not a wrong answer, it is no answer, and averaged into a score it reads as a tie.

**Changed.** Reverted. `models:compare` now runs three rounds and ranks on the WORST round. Added `probe:schema`, which measures reliability of the shape as its own axis.

**Outcome.** Probe over 30 structured-output calls each: Qwen3-235B 30/30, DeepSeek-V4-Flash 26/30. Classifier back on Qwen, now 15/15 on three separate runs.

> Correctness of the content and reliability of the shape are different axes. Measure both.

<sub>commits `dbb98c4`, `6d34ad6`, `a471c8d`</sub>

### Ten of ten specialist sessions died

**Wrong.** Moving the specialist tier to a cheaper model produced 10/22 (45%) against a 46/50 baseline. Every child session failed and not one recorded a vendor.

**Why.** Not only the model. The subagent carried an `outputSchema` added to guarantee a structured return, and eve escalates a schema the model cannot produce to `OUTPUT_SCHEMA_NOT_FULFILLED` — which fails the whole child session. Several specialists died before searching once. The model also reached for the final report instead of recording as it went, so there was no partial progress for the incremental design to protect.

**Changed.** Reverted the model, and deleted the `outputSchema` entirely — it was redundant, since findings reach the planner through the KV research store and never through the child's return value.

**Outcome.** 33/37, then 52/53 (98%) after the next fix.

> A structured return on a long-running sub-agent is a single point of failure with no upside when a durable store already holds the result.

<sub>commits `9d99cd0` · runs `wrun_41M16HDBKG0GZGAQNQ1HDK14XR`</sub>

### A guardrail that caused a search-budget death spiral

**Wrong.** Three specialists under-recorded. The catering scout ran seven consecutive searches for a single drive time, spent its entire 25-search budget, and recorded one vendor.

**Why.** I had required every vendor to state its drive time from the couple. There is no geocoder, and a web search cannot answer 'how long is the drive from A to B'.

**Changed.** The town stays required — it is a fact readable off the vendor's site. The drive note is optional, and the scout is told explicitly never to search for one: place the town from what it already knows, or skip the vendor.

**Outcome.** 33/37 to 52/53 (98%) — the best result measured. Radius judge 100% across all five categories, so the discipline held while the volume came back.

> Asking a model for a fact its tools cannot reach turns a guardrail into a death spiral.

<sub>commits `d0a723a` · runs `wrun_41M16NZKKB0GJNG65GT0HQ5BGW`</sub>

### A page section that existed only in development

**Wrong.** The generations table rendered locally and was simply absent from the deployed page. Build passed, typecheck passed.

**Why.** `readFileSync` against `new URL(..., import.meta.url)` finds nothing inside a bundled serverless function — the JSON is never traced into the output — and the try/catch around it turned that into a silently empty section.

**Changed.** Imported the JSON as a module so the bundler carries it.

**Outcome.** Caught only by fetching the deployed page and asserting its content. Nothing in the local gate could have found it.

> A local gate cannot see a production-only failure. Assert against the deployed artifact.

<sub>commits `a632e1e`</sub>

### The dashboard reported a model that had been reverted hours earlier

**Wrong.** `/observe` publicly displayed 73% for reply understanding. The shipped configuration scores 100%.

**Why.** The classifier was reverted but the eval was never re-run, so KV kept the losing model's summary. Nothing compares an eval's recorded model against the live routing.

**Changed.** Re-ran the eval to correct the record.

**Outcome.** Back to 15/15, matching what is deployed. The structural fix — having the console flag a summary whose model no longer matches the routing — is recommended and not yet built.

> Observability that lies is worse than none, and this was the observability lying about itself.

### The engineering panel wore another product's colours, below the fold

**Wrong.** The observability panel used teal, pale blue, periwinkle, navy and lime — none of which exist in the product. During a fan-out, six agent cards pushed the live event stream entirely off screen.

**Why.** The diagram had been recreated from a reference architecture image, palette included, and the rendered page had never been looked at.

**Changed.** Every plane takes a Venus hue through the same tokens as the rest of the app. The panel became a bento of tiles; lanes collapsed to one dense row each with only the selected one expanded.

**Outcome.** All five tiles visible at 1440x900 while the agent runs. Verified by screenshot, in development and again in production.

> Typecheck, build and evals all pass happily on a panel that renders off the bottom of the screen.

<sub>commits `4d43b34`</sub>

### Every cost was inflated by ~1.9x

**Wrong.** Cost per plan was reported as $1.50. Nothing looked wrong; the number was plausible.

**Why.** Token Factory serves a repeated prompt prefix from cache — measured at 90.7% of all input tokens across 33 agents. On the OpenAI-compatible wire `prompt_tokens` INCLUDES `cached_tokens`, and `costFor` was adding the two together, so every cached token was billed twice.

**Changed.** Bill `inputTokens` once. Recompute cost from tokens on read rather than trusting the stored figure, so the whole history is corrected rather than only what happens next. Surface the cache hit rate in the app, because it is now the number that explains the cost.

**Outcome.** A real traced plan: $1.50 reported, $0.80 actual — 47% lower. Cached reads are still charged at the full prompt rate here, so this remains a deliberate over-estimate.

> A plausible number nobody cross-checks is indistinguishable from a correct one.

<sub>runs `wrun_41M16NZKKB0GJNG65GT0HQ5BGW`</sub>

### A failed search was recorded as a successful tool call

**Wrong.** The trace reported 258 web searches across recent runs and zero failures. Jared then mentioned Tavily had been out of credit.

**Why.** `web_search` reports its own failure in the payload — `{status: "search_failed"}` — rather than throwing. The runtime sees a tool that returned cleanly, so the trace marked it ok. There were 19 distinct status literals across the tools and the first fix covered three of them: `blocked` (4 uses), `not_found` (6), `not_configured` (11), `cap_reached` and `unavailable` all still counted as healthy. `record_vendor` also counted a guard refusal as a recorded vendor, which inflated the health check that decides whether a category needs re-running.

**Changed.** The outcome taxonomy moved into agent/lib/actions.ts, beside `actionName`, for the same reason that lives there: the trace store, the live rail and the stack diagram each carried a private copy of "did this work" and all three were wrong the same way. Success, refusal and failure are now one shared reading, ordered to match eve's protocol rather than assumed. `tools` counts calls requested, so a search refused at the budget cap is subtracted through `toolRuns` before any surface reports a search count. Two tests guard it: `test:outcomes` reads the status literals back out of the sources and fails on any the taxonomy does not classify, and `test:fold` runs the trace fold over events shaped the way eve actually delivers them. Both are in `npm run verify`.

**Outcome.** Tavily was in fact healthy through those runs — 258 searches, all real. But the metric could not have told us either way, which is the point. Two rounds of code review then found the same defect reproduced at smaller scale each time: the first fix covered 3 of 19 statuses and left both UI surfaces on the old exception-only test; the second classified the statuses correctly but was still wrong in the code that consumed them. `actionOutcome` read eve's `data.error` before its `status`, and eve attaches an error to a rejection as well as to a failure, so every approval-gate denial was still counted as a failure and `refusedActions` could never leave zero. The rail displayed one refusal as both failed and refused.

> A tool that returns "I failed" as a successful result is invisible to anything counting exceptions. Two follow-up fixes then failed the same way for a subtler reason: each was tested one level below where it was wrong. Unit-testing the taxonomy while nothing exercised the fold that consumes it is how a correct table and an incorrect reading of it shipped together, twice.

## 2026-08-30

### An eval that graded a run in flight published it as a score

**Wrong.** `/observe` served the research eval as 7/12, 58%, under the heading "Research quality", while `/cookbook` cited 52/53 for the same command. Both pages are public.

**Why.** `eval-scout.ts` waits for the specialist fan-out to go quiet before it reads anything — that wait exists because grading early once scored "0 recorded" against scouts that were still searching. When the wait gives up it grades anyway, and saves the result like any other summary. The stored run had settled nothing: its first case read `expected "completed", got "waiting (32s)"` against the 114s a real fan-out takes, and it carried 12 checks where a full run produces 37-53. Neither number was wrong. 58% was a reading of timing, not of research.

**Changed.** `EvalSummary` gains `incomplete`, a reason string set whenever a brief's specialists never settled inside `EVAL_SETTLE_TIMEOUT_MS`. `/observe` renders such a summary as "not scored" with the reason under it instead of a percent chip, `npm run report` prints NOT SCORED in place of the percentage, and the script says NOT A SCORE on stdout before it saves.

**Outcome.** The two public surfaces stopped disagreeing: an unsettled run reads as unscored on `/observe` and in `npm run report`, and 52/53 is again the only research score either page quotes. The counts stay visible — the run is still evidence of something, it just stops being a verdict. Nothing yet re-runs an incomplete summary or expires it from KV, and no test covers the flag: it is set in one script and read in two places, all three by hand.

> When a measurement's precondition fails the honest output is no score, not a low one. Publishing the arithmetic anyway makes the panel wrong about what the number means rather than about the number.

<sub>commits `c6f86f0`</sub>

### The radius rule lived only in the prompt, and a settled run measured what that is worth

**Wrong.** A settled eval run failed the radius judge in four of five categories — 10 of 18 sampled vendors out of region for a brief stating one hour. The recorded towns included Jackson NH (~98 straight-line miles, the White Mountains), Tamworth NH (~79) and Keene NH (~57). Every town was recorded honestly; that is how the judge caught it.

**Why.** The death-spiral fix had removed the required drive time because no tool here can produce one, and the rule fell back to prose: 'you know roughly where towns are.' The model states towns truthfully and cannot do the arithmetic between them, so the hard limit decayed the way any rule that lives only in a prompt decays.

**Changed.** record_vendor measures the distance itself. The scout echoes the couple's town and radius from its brief (couple_location, max_drive_minutes — optional, so a schema mismatch can never kill a child session), both towns geocode through Nominatim with one cached lookup per town, and a vendor beyond ~0.75 straight-line miles per stated drive minute is refused as rejected_outside_radius. Every failure to judge falls open, the liveness guard's rule. Drive time stays unproducible; distance was checkable all along — the same boundary the guards recipe draws, read more carefully.

**Outcome.** First guarded run: five radius refusals in the traces and all twelve recorded vendors within 38 straight-line miles of the couple. Next scored run settled 5/5 at 49/54 (91%), 13 of 14 recorded vendors within 40 miles; one 55-mile caterer recorded through the deliberate fail-open when its scout omitted the brief echoes. The eval's radius judge, which reasons in drive time, still flagged six of fourteen — the two instruments now disagree in public, and the guard is the one with arithmetic behind it. Nothing yet measures how often scouts omit the optional echoes.

> The boundary is not facts your tools can produce but facts your tools can check. The drive time was neither, and the rule written in its place decayed in prose; the distance was always checkable, and the tool that measures it beats the prompt that remembers it.

<sub>commits `b661640` · runs `wrun_41M1AHFAF50GVR8AVD8TNN9M5N`, `wrun_41M1AJKFEP0GP2F1JBV4D5ND81`</sub>

## 2026-08-31

### The guard obeyed a radius nobody had given, and the third tier repeated the first

**Wrong.** First live run after the radius guard shipped: the planner delegated three different radii to three scouts for one couple — 10 minutes to venues, 25 to catering, 60 to styling — for a brief that named no radius at all. Twelve of sixteen recordings were refused as rejected_outside_radius, a White River Junction caterer (~20 straight-line miles) by one mile against a ~19-mile limit. The 7.5-mile venue circle left two venues for three tiers, and the plan's third tier re-showed the first tier's venue and photos, identical URLs. The couple noticed the repetition before any instrument did.

**Why.** The guard enforces whatever number arrives, and the number arrives in the planner's delegation prose. The UI never asks for a travel radius, so silence is filled by invention — and the arithmetic at the boundary enforced an invented 10 exactly as faithfully as a stated 60. Guarding the write boundary had moved the failure upstream, not removed it.

**Changed.** outsideRadius floors the enforced minutes at 45 (MIN_DRIVE_MINUTES): below the floor it tests against 45, a stated hour is untouched, and the rejection note now quotes the minutes actually enforced. get_research returns venue_supply — venues recorded, how many carry photos, and the instruction to delegate one more venue scout when three tiers face fewer than three venues — at the last tool read before the options are written. The planner's instructions pin ONE radius per wedding (the couple's, or 60 when unstated) and a different venue per tier whenever the research holds three.

**Outcome.** Replayed in the guard tests with pinned coordinates: White River Junction vs Fairlee at 25 minutes — the real one-mile refusal — records now; Burlington stays refused at 10 and at 60; 20 of 20 cases hold. The floor and the supply count are the two pieces a tool now holds; one-radius-per-wedding and distinct-venues-per-tier remain prompt rules, the decayable kind, and no eval yet counts how often a plan repeats a venue.

> A guard is only as good as the number it is handed. Arithmetic at the boundary cannot validate an invented input — but a floor on what the boundary will enforce turns the worst invention into a survivable one.

<sub>commits `5823f6f` · runs `wrun_41M1C6R9FV0GMZE9E158CGCPGE` · tests `scripts/test-vendor-guards.mjs`</sub>

### Ten briefs in parallel, zero weddings in chat: the question tool was the deadlock

**Wrong.** A 10-brief parallel load test on production returned 0 of 10 complete three-option presentations in chat within 12 minutes. Seven briefs never reached a plan: scouts and planners paused on questions ('use directories, or slow down?', a rate-limit process question, how to work around one blocked site), and one planner wrote itself a to-do list after announcing 'coming right up' and went silent. The three that saved a plan to the gallery gave the couple's thread a 500-700 character stub with no photos and no tables. A concurrent single-run verification hit the same wall: four scouts done, the music scout parked on input.requested at minute 13, save_wedding_plan never reached.

**Why.** Three framework tools nobody had decided to grant. ask_question was live on every scout, and a child lane's question renders in no UI — nobody can ever answer it, the scout() call never returns, and the planner cannot even reach get_research's stall guard, which sits behind the return. web_fetch was live on scouts, an unbudgeted retrieval path past the recipe's 'two tools' sentence. todo was live on the root, and bookkeeping ended the turn the couple was waiting on. Under parallel load, retrieval errors made all three attractive.

**Changed.** Three disableTool() shadows — scout ask_question, scout web_fetch, root todo — the same slot mechanism as the six existing scout disablements, validated by name at build. Instructions state the spine the shadows enforce: questions exist for exactly two moments (the one brief check, the tier pick), never for process; a scout has nobody to ask and recovers or reports; the full plan streams to the couple BEFORE save_wedding_plan, whose result note now repeats the rule. The landing checklist says research starts after the couple's first answer.

**Outcome.** build:eve resolves the graph with the three shadows (a wrong filename throws, listing valid names), the recipe-02 proof commands print the same two-file scout surface, and all eight verify gates pass. The mechanical guarantees are the removals; present-before-save and no-process-questions remain prompt rules, the decayable kind. Not yet re-measured under 10-brief parallel load; the single-run verification is queued behind this deploy.

> A tool surface is what the framework grants minus what you explicitly refuse — not what your instructions describe. Every capability you never disabled is a failure mode you never designed, and load is what finds it.

<sub>commits `8c9a66f` · runs `wrun_41M1C8DE2Y0GVK9ZRKNXTPGCTS`, `wrun_41M1C80F110GXWHXCV00BP7TGZ`, `wrun_41M1C80EZ50GXAYHS38QVGE41T` · tests `cookbook/02-a-smaller-tool-surface/README.md`</sub>

---

## How to read the outcomes

Scores are from `npm run eval:scout`, which drives a fixed brief against the live
deployment, waits for the specialist fan-out to settle, then grades what was recorded:
coverage, distinct vendors, a working contact path, sources on the vendor's own site,
addresses that belong to the vendor, a stated town, live URLs, venue photos, and two
judge questions — is this a real business, and is it inside the couple's radius.

| Run | Score | What changed since the previous run |
|---|---|---|
| first clean measurement | 29/33 (88%) | — |
| with the tool-level guards | 46/50 (92%) | directory sources and vendor-mismatched emails refused |
| cheaper specialist model | **10/22 (45%)** | 10 of 10 sub-agent sessions failed |
| reverted, schema deleted | 33/37 (89%) | sessions healthy, volume suppressed by my own guardrail |
| drive-time fix | **52/53 (98%)** | radius judged from town knowledge instead of searched for |

The 45% row is kept deliberately. It is the generation most write-ups omit, and it is the
one that proves the cheap-model swap is only safe over a harness that survives it.

