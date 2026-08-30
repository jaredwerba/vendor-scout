# Evaluation — Hold the Set, Pin the Judge

> Correctness of the content and reliability of the shape are different axes. Measure both.

Recipe **09 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → Governance → Cost → Latency → Observability → **Evaluation** → Verification

Five candidates for the vendor-reply classifier, swept over the same fifteen human-labelled replies
on 2026-08-29, one pass each. Recorded in [`models.ts`](../../agent/lib/models.ts):

```text
deepseek-ai/DeepSeek-V4-Flash        100%   $0.0020   1570ms
Qwen/Qwen3-235B-A22B-Instruct-2507   100%   $0.0023   1203ms
zai-org/GLM-5.3-Flash                 93%   $0.0041   2633ms
nvidia/Nemotron-3_5-Lightning         80%   $0.0077   6613ms
Qwen/Qwen3-30B-A3B-Instruct-2507      73%   $0.0013   1851ms
```

The classifier was switched to the model at the top of that table. The very next run of the same
fifteen cases scored 11/15, six of them because no object came back at all.

The prices are not the interesting column. The interesting fact is that a sweep with a ground-truth
label on every case, run correctly, over a dataset that did not move, still recommended the wrong
model — because it was answering a narrower question than the one being asked of it. Both faults
below are dated entries in [`decisions.json`](../../evals/data/decisions.json), which generates the
[engineering log](../../docs/engineering-log.md).

## What you'll build

```
evals/
  evals.config.ts              # the judge, pinned once, inherited by every eve eval
  data/vendor-replies.json     # 15 human-labelled replies — the set that does not move
  data/briefs.json             # 3 fixed briefs: region, budget, opening message
  harness/types.ts             # the RunResult contract both architectures emit
scripts/
  compare-models.ts            # npm run models:compare — 3 rounds, ranked on the worst
  probe-structured-output.ts   # npm run probe:schema — does an object come back at all
  eval-replies.ts              # npm run eval:replies — the production classifier on the fixed set
  eval-scout.ts                # npm run eval:scout — drives real turns, judges what was found
  simulate.ts                  # npm run simulate — fresh attacks, semantic grading
  grade.ts                     # npm run grade — one grader, two architectures
agent/lib/models.ts            # the judge role and its own env var
runs/                          # one committed RunResult per system per brief
```

## Prerequisites

- `NEBIUS_API_KEY` — every script here makes real Token Factory calls; none of them mock a model.
- Node 24 — `package.json` declares `engines.node: "24.x"` — and `npm install` at the repo root.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN`, optional: without them the scripts print and skip the
  `/observe` summary rather than failing.
- `LANGSMITH_API_KEY`, optional: `eval:replies` files the same run as a LangSmith experiment.
- Recipe 01 (Foundation) first. The judge is a role in the registry, and pinning it is only
  meaningful once roles exist.

## Run it

```bash
npm install
PROBE_ROUNDS=1 npm run probe:schema -- \
  Qwen/Qwen3-235B-A22B-Instruct-2507 deepseek-ai/DeepSeek-V4-Flash
```

One character per call — `.` for an object, `x` for nothing. Captured 2026-08-30:

```text
...............
Qwen/Qwen3-235B-A22B-Instruct-2507
  15/15 honoured the schema · 0% failure rate over 1 rounds
xxxxxx..xxx.xxx
deepseek-ai/DeepSeek-V4-Flash
  3/15 honoured the schema · 80% failure rate over 1 rounds
   9× AI_NoObjectGeneratedError: No object generated: the model did not return a response.
   3× AI_NoObjectGeneratedError: No object generated: could not parse the response.
```

One round on one day, and the same script measured the same model at 4 failures in 30 the day
before. The number moving is the finding. Twelve of those fifteen calls produced no object for
anything downstream to be right or wrong about, and an accuracy sweep that credits whatever the
production fallback returns instead scores that as a tie with the line above it.

`probe:schema` with no arguments measures the registry defaults for the classifier, scout and
judge roles, not an env override. `PROBE_ROUNDS` defaults to 2 and `COMPARE_ROUNDS` to 3, for the reason above.

## Walk-through

### The set does not move

[`evals/data/vendor-replies.json`](../../evals/data/vendor-replies.json) is fifteen replies with a
hand-written `expected` intent on each, across the seven intents the classifier can return, named
for what they test: `conditional-not-decline`, `quoted-reply-thread`, `malformed-html-reply`,
`injection-in-reply`, `other-auto-reply`. Three scripts read that one file —
[`eval-replies.ts`](../../scripts/eval-replies.ts) scores the production classifier on it,
[`compare-models.ts`](../../scripts/compare-models.ts) runs the same cases with `modelId`
overridden per candidate, and
[`probe-structured-output.ts`](../../scripts/probe-structured-output.ts) reuses the reply texts and
throws the labels away.

**The eval calls the shipped function, not a copy of it.** `eval-replies.ts` imports `classifyReply`
from [`classify.ts`](../../agent/lib/classify.ts) — the same function
[`inbound-email.ts`](../../agent/channels/inbound-email.ts) calls when a real vendor replies, with
the same prompt, the same precedence rules and the same injection warning. An eval that
reimplements the thing it measures grades a second implementation, and the two drift the first time
somebody edits one prompt.

**Fifteen cases is small, and the source says so rather than hiding it.** The comment above `ROUNDS`
in `compare-models.ts` states the ceiling — one pass over fifteen cases can only rule out the
clearly worse — and everything below follows from taking that sentence literally.

### Count the fallback as a loss, then rank on the worst round

`classifyReply` degrades to a keyword heuristic when the model is unreachable, because in production
a vendor's reply must never be lost over a classification failure. In a sweep that same behaviour
lies: `DECLINE_HINTS` matches, among others, `unavailable|already booked|unsubscribe|not interested`, so a model
returning nothing at all still gets cases right by accident.

```ts
// A heuristic fallback means the model failed to return the schema —
// that is a failure of this candidate, not a free pass.
if (via === "heuristic") fallbacks += 1;
const ok = intent === c.expected && via === "model";
```

`via === "model"` is the load-bearing half of that condition. Without it the score measures the
union of the model and its fallback — the right thing to ship, and the wrong thing to compare.

```ts
const ROUNDS = Number(process.env.COMPARE_ROUNDS ?? 3);
// …
rows.sort((a, b) => b.worstScore - a.worstScore || b.score - a.score || a.costUsd - b.costUsd);
// …
// A candidate has to be perfect in EVERY round to be considered — one bad
// round out of three is exactly the signal a single pass would have hidden.
const cheapestPerfect = rows.filter((r) => r.worstScore === 1).sort((a, b) => a.costUsd - b.costUsd)[0];
```

**The anti-pattern is ranking on the mean.** A mean averages a bad round into a good one and reports
a number no run ever produced, then names a model that has already failed in front of you. The
primary key is `worstScore`, and cost is only the third tiebreak, so a cheaper candidate cannot buy
its way past one bad round. Even so the script refuses to close the argument: its recommendation
line tells you to run the sweep once more, because a model that wins one sweep and fails the next is
the failure mode the harness exists to catch.

### The probe asks a question accuracy cannot

[`probe-structured-output.ts`](../../scripts/probe-structured-output.ts) is seventy-five lines and
the one that settled it:

```ts
try {
  await generateObject({ model: tokenFactoryModel(id), schema: replyIntelSchema, prompt: ... });
  ok += 1;
  process.stdout.write(".");
} catch (error) {
  fail += 1;
  process.stdout.write("x");
  const key = `${(error as Error)?.name ?? "Error"}: ${String((error as Error)?.message ?? error).slice(0, 90)}`;
  errors.set(key, (errors.get(key) ?? 0) + 1);
}
```

There is no `expected` anywhere in it. The only question is whether an object comes back, and the
error text is counted per distinct message rather than collapsed into a rate — two different
problems otherwise wear one number. Over thirty structured-output calls each:

```text
Qwen/Qwen3-235B-A22B-Instruct-2507    0/30 failed
deepseek-ai/DeepSeek-V4-Flash         4/30 failed (13%)
  2× "the model did not return a response"
  2× "could not parse the response"
```

**A call that never returns an object is not a wrong answer, it is no answer.** Averaged into an
accuracy score it reads as a tie, because there is nothing there to be wrong. Downstream it is worse
than a wrong answer: the classifier falls back to keywords, a reply is filed on a regex, and a
follow-up chases a vendor who already said yes. The failure rate is not the interesting number. The
interesting number is the zero beside it that the accuracy sweep also reported.

### The judge gets its own env var

[`evals.config.ts`](../../evals/evals.config.ts) is twenty lines and the whole point is one field —
`judge: { model: modelFor("judge") }`, the shared default for every eve eval. It resolves through
the registry in [`models.ts`](../../agent/lib/models.ts), where the judge is a role like any other
and, unlike any other, is never the model under test:

```ts
judge: {
  model: "deepseek-ai/DeepSeek-V4-Pro",
  env: "NEBIUS_JUDGE_MODEL",
  contextWindow: 1_048_576,
  rationale:
    "Strongest general reasoner in the catalog at a price an eval can afford. Pinned away " +
    "from every other role so a model swap can never change how results are graded.",
},
```

**Why its own env var rather than inheriting the agent's?** Because the entire purpose of a sweep is
to change the agent's model, and a judge that follows it moves the measuring instrument in the same
command that moves the thing being measured. Were the judge to inherit `NEBIUS_MODEL`, pointing that
at a stronger model would lift every score at once, including the parts of the system nobody
touched. `NEBIUS_JUDGE_MODEL` exists so the bar moves deliberately, in its own commit, as its own
decision.

The pin holds at every other judgement. [`eval-scout.ts`](../../scripts/eval-scout.ts) and
[`grade.ts`](../../scripts/grade.ts) both call `modelFor("judge")` for the vendor verdict, and
[`simulate.ts`](../../scripts/simulate.ts) uses it twice — once to write the adversarial emails
(`// The attacker is deliberately not the model under test.`) and once to decide whether the defence
held. Its summary line records both sides: `attacker ${modelIdFor("judge")} · defender
${modelIdFor("classifier")}`.

Simulation is also where the limits of a judge are said out loud. The attacker labels its own emails
with a `true_intent`, and `simulate.ts` reports agreement with those labels as *advisory only* —
they are generated, not ground truth. A suite whose cases are invented fresh every run is not a
fixed set, however good the score looks.

Ask a pinned judge two questions, not one. Both graders hand it a single finding and two booleans; this is the schema in [`grade.ts`](../../scripts/grade.ts), and `eval-scout.ts` carries a near-identical one:

```ts
const verdictSchema = z.object({
  real: z.boolean().describe("A real, currently-operating business of this category?"),
  serves_region: z.boolean().describe("Located INSIDE the couple's stated travel radius?"),
  reason: z.string().max(220),
});
```

**A blended score is a score you cannot act on.** The comment above the call site in `eval-scout.ts`
gives the reason: an invented vendor is a fabrication, a vendor twenty minutes past the radius is a
judgement call, and scoring them as one number hid which was happening. The fix for each is a
different change to a different file. Neither script judges everything either — both take
`list.slice(0, 4)` per category to keep the eval affordable, a sampling bias declared in the source
rather than buried in a methodology note.

### One grader, two architectures

[`evals/harness/types.ts`](../../evals/harness/types.ts) defines a `RunResult`: status, wall clock,
one `AgentFacts` per agent, findings by category. Both implementations write it, and
[`grade.ts`](../../scripts/grade.ts) is the only thing that turns one into a score. It reads
`run.system` to print a label and never branches on it. Two committed runs of the same fixed brief,
read out of [`runs/`](../../runs/):

```text
runs/eve-boston-boho.json   | eve-vercel v18         | 6 agents | 113955ms | waiting   | 14 vendors
runs/graph-boston-boho.json | langgraph-nebius 0.1.0 | 7 agents |  55571ms | completed | 19 vendors
```

Neither line is a result. They are inputs, and the collectors that write them do no grading at all —
which is the property that matters, because a collector that scores its own stack is a collector
with an opinion. **Two graders that "do the same thing" is how a comparison quietly becomes
marketing.** One contract, one grader, one set of briefs; the stack is a string.

### The eval that spends money is a different kind of eval

The three above are fixed sets against one function call.
[`eval-scout.ts`](../../scripts/eval-scout.ts) drives real planning turns against a running Venus,
and the hard part is knowing *when* to read the result. Two of its own bugs are recorded in its
comments: Venus parks the moment she dispatches her scouts, so an early read scored `0 recorded`
against specialists that were still searching, and the nudge loop counted `subagent.called` — which
eve 0.24.4 never delivers on the parent stream — concluded nothing had been delegated, and bought a
whole extra fan-out per re-prompt. **An eval that measures the system wrong costs more than no
eval.** Neither threw.

What it caught is the second decision this recipe is built on. The specialist tier was moved to a
cheaper model, and the decision record for that run reads:

```text
eval:scout · boston-boho | DeepSeek-V4-Flash in the scout role: 10/22 (45%)
10/10 specialist sessions failed · not one recorded a vendor
```

The model was not the whole cause. The subagent carried an `outputSchema` added to guarantee a
structured return, and eve escalates a schema the model cannot produce to
`OUTPUT_SCHEMA_NOT_FULFILLED`, failing the entire child session — several specialists died before
searching once. Reverting the model and deleting the schema gave 33/37, then 52/53 after the next
fix. The schema was redundant anyway: findings reach the planner through the research store, never
through the child's return value.

**Two changes landed in that run, and one number could not tell them apart.** The score said the
candidate failed; the decision record names two causes, and only one of them was the model. That is
the argument for keeping failure text beside the score, which is why `probe:schema` counts error
strings and `grade.ts` carries the judge's `reason` into the failing case note.

### What this suite still cannot tell you

The planner — the role that writes every word the couple reads — has no eval that measures its prose
or its orchestration. [`models.ts`](../../agent/lib/models.ts) says as much in the role itself: held
constant until an eval can measure the swap. The one role where quality outranks price is the one
role chosen without a measurement.

The scout role was not selected by a sweep either. It was argued for on input price and context
length, then *vetoed* by `eval:scout`. A veto is a weaker instrument than a comparison, and the
rationale says what to do about it: re-test any candidate with `npm run eval:scout` before it takes
the role.

Three briefs, fifteen replies, four sampled vendors per category, both `RunResult` files committed
and no scorecard over them, and nothing geocodes — so the radius judge reasons about a drive it
cannot measure. Those are the real ceilings on every number here, and listing them costs less than
defending a figure that was never that strong.

### Taking it somewhere that is not a wedding

The point is not weddings specifically. This pattern transfers to any domain where a model returns
structured output over untrusted text and something downstream acts on it: a claims-triage pipeline
turning adjuster notes into a decision code, a support router assigning tickets to queues, an
invoice extractor pulling line items out of supplier PDFs, a compliance reader classifying contract
clauses. All four carry the same two axes and the same trap — accuracy is easy to measure and easy
to over-trust, while schema reliability stays invisible until a downstream fallback quietly answers
on the model's behalf. Hold one labelled set constant across every candidate, count a fallback as a
loss, run more than once and rank on the worst run, and give whatever grades the output a name and
an env var of its own. The domain decides what the labels mean. It does not change that a model can
be right every time it answers and still refuse to answer.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| A candidate wins a sweep, then fails the same cases on the next run | One pass over fifteen cases cannot separate two models near the top | `COMPARE_ROUNDS` defaults to 3 and ranking is on the worst round ([`compare-models.ts`](../../scripts/compare-models.ts)) |
| Accuracy looks unchanged but replies are misfiled in production | The model returned no object and the production keyword fallback answered instead | Score `via === "model"` only, and measure the shape separately with `npm run probe:schema` |
| Two models tie on accuracy and one is far worse in use | An accuracy score cannot see a call that returns nothing — there is nothing to be wrong | The probe counts objects rather than answers, and keeps each error string ([`probe-structured-output.ts`](../../scripts/probe-structured-output.ts)) |
| Every score moves after a model swap, including untouched cases | The judge inherited the agent's model | `judge: { model: modelFor("judge") }` on its own `NEBIUS_JUDGE_MODEL` ([`evals.config.ts`](../../evals/evals.config.ts)) |
| `eval:scout` reports `0 recorded` for every specialist | The parent turn settles when scouts are dispatched, not when they finish | Poll the trace tree until no child is `active`, bounded by `EVAL_SETTLE_TIMEOUT_MS` |
| One eval run triggers several full fan-outs | `subagent.called` never arrives on the parent stream, so the nudge loop re-prompted | Count `actions.requested` entries whose `kind` is `subagent-call` |
| A whole child session fails and records nothing | An `outputSchema` the model cannot produce escalates to `OUTPUT_SCHEMA_NOT_FULFILLED` | Delete it; findings reach the planner through the research store, not the return value |
| A live vendor is scored as a dead source | A 403 is bot blocking, not a missing page | `isLive` accepts 403, 405 and 429; `grade.ts` fails only on 404 and 410 |
| An adversarial run reports a breach that did not happen | A regex cannot tell "quoted the attack" from "followed the attack" | A semantic grader is asked whether the agent *acted* on the instruction ([`simulate.ts`](../../scripts/simulate.ts)) |
| A comparison flatters whichever stack you built | Each implementation graded itself | One `RunResult` contract, one `grade.ts`, identical fixed briefs ([`harness/types.ts`](../../evals/harness/types.ts)) |

## Test it

```bash
npm run eval:all   # test:guards · eval:replies · simulate · eval:scout · eve eval --tag fast
```

That chain ends by driving real planning turns against the deployed agent, so it spends research
credits and takes minutes — `npm run eval:replies` alone is the fast half.

What the suite guarantees is a property, not a score. Every eval script that prints a score also prints
the model that produced it and, where a judgement was involved, the model that graded it, and by
default those two are never the same id; `grade.ts` writes its judge to the summary rather than stdout. The labelled set is committed, so a score is reproducible against the
exact cases that produced it; the adversarial set is not, and says so in its own output. There is no
badge and no pass threshold — the suite exists to make a swap arguable, not to declare one safe.

## Going further

- **Raise the rounds before you trust a winner.** `COMPARE_ROUNDS` and `PROBE_ROUNDS` are env vars
  precisely so the cost of certainty is a dial. The default of three carries its reason in the
  comment directly above it: a model that won a single-pass sweep at 15/15, then scored 11/15 on the
  very next run of the same cases.
- **Probe the incumbent, not only the suspect.** `probe:schema` with no arguments measures the
  registry defaults for the classifier, scout and judge roles. An incumbent nobody re-measures is
  an assumption wearing a measurement's clothes.
- **Give the planner an eval before you swap it.** The registry comment puts it at 15% of a plan's cost — a share
  nothing measures — and it is 100% of what the couple reads. [`synthesis.eval.ts`](../../evals/synthesis.eval.ts) is the nearest model
  for one: a full turn, a hard assertion that every presented total fits the budget, and a judged
  rubric over that.
- **Publish the scorecard, not only the runs.** [`runs/`](../../runs/) holds a `RunResult` per
  system per brief and `npm run grade` scores them with identical code. Until that output is
  committed, the fairness of the comparison is a design property rather than a published one.
- **Next: [Verification — Assert Against the Deployed Artifact](../10-assert-against-the-deployed-artifact/).**
  A score is only as true as the artifact it was taken from. The last recipe is about the gap
  between a check that passes locally and a build that behaves in production.

## License

Unset — this repository carries no LICENSE file, so no reuse rights are granted by default.
