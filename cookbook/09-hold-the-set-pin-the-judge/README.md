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
label on every case, run correctly, on a dataset that did not move, still recommended the wrong
model — because it was answering a narrower question than the one being asked of it.

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
npm run probe:schema     # structured-output reliability, per model, labels ignored
npm run models:compare   # accuracy over the labelled set, three rounds, ranked on the worst
```

`probe:schema` defaults to the models currently serving the classifier, scout and judge roles; pass
ids to measure a candidate instead. One character per call, `.` for an object and `x` for nothing:

```text
deepseek-ai/DeepSeek-V4-Flash
  15/15 honoured the schema · 0% failure rate over 1 rounds
```

A clean round is not a result. `PROBE_ROUNDS` defaults to 2 for the same reason `COMPARE_ROUNDS`
defaults to 3 — the failure this whole recipe is about only appeared on the second run.

## Walk-through

### The set does not move

[`evals/data/vendor-replies.json`](../../evals/data/vendor-replies.json) is fifteen replies with a
hand-written `expected` intent on each, across the seven intents the classifier can return. The
cases are named for what they test: `conditional-not-decline`, `quoted-reply-thread`,
`malformed-html-reply`, `injection-in-reply`, `other-auto-reply`.

Three different scripts read that one file.
[`eval-replies.ts`](../../scripts/eval-replies.ts) runs the *production*
`classifyReply` over it and scores intent accuracy.
[`compare-models.ts`](../../scripts/compare-models.ts) runs the same function over the same cases
with `modelId` overridden per candidate. [`probe-structured-output.ts`](../../scripts/probe-structured-output.ts)
reuses the fifteen reply texts and the production `replyIntelSchema` and throws the labels away.

**The eval calls the shipped function, not a copy of it.** `eval-replies.ts` imports
`classifyReply` from [`agent/lib/classify.ts`](../../agent/lib/classify.ts) — the same function the
inbound-reply path calls in production, with the same prompt, the same precedence rules and the
same injection warning. An eval that reimplements the thing it measures grades a second
implementation, and the two drift the first time somebody edits one prompt.

**Fifteen cases is small, and that is a stated limit rather than a footnote.** The comment above
`ROUNDS` in `compare-models.ts` says what the set can and cannot do: one pass over fifteen cases
cannot separate two models near the top, it can only rule out the clearly worse. Everything below
follows from taking that sentence literally.

### A fallback that scores as a pass is a broken eval

`classifyReply` degrades to a keyword heuristic when the model is unreachable, because in
production a vendor's reply must never be lost over a classification failure. In a sweep that same
behaviour is a liar: `DECLINE_HINTS` matches `unavailable|already booked|unsubscribe|not
interested`, so a model that returns nothing at all still gets several cases right by accident.

[`compare-models.ts`](../../scripts/compare-models.ts) refuses the free pass:

```ts
// A heuristic fallback means the model failed to return the schema —
// that is a failure of this candidate, not a free pass.
if (via === "heuristic") fallbacks += 1;
const ok = intent === c.expected && via === "model";
```

`via === "model"` is the load-bearing half of that condition. Without it the score measures the
union of the model and its fallback, which is the right thing to ship and the wrong thing to
compare.

### Rank on the worst round

```ts
const ROUNDS = Number(process.env.COMPARE_ROUNDS ?? 3);
```

```ts
rows.sort((a, b) => b.worstScore - a.worstScore || b.score - a.score || a.costUsd - b.costUsd);
// A candidate has to be perfect in EVERY round to be considered — one bad
// round out of three is exactly the signal a single pass would have hidden.
const cheapestPerfect = rows.filter((r) => r.worstScore === 1).sort((a, b) => a.costUsd - b.costUsd)[0];
```

**The anti-pattern is ranking on the mean.** A mean over three rounds averages a bad round into a
good one and reports a number no run ever produced; the recommendation then names a model that has
already failed in front of you. The primary sort key is `worstScore` and cost is the third
tiebreak, so a cheaper model cannot buy its way past a bad round. Even then the script does not
close the argument — it prints, in its own output, that a candidate winning one sweep and failing
the next is the failure mode the harness exists to catch, and tells you to run it again.

### The probe asks a question accuracy cannot

[`probe-structured-output.ts`](../../scripts/probe-structured-output.ts) is the smallest script in
the repository and the one that settled the argument:

```ts
try {
  await generateObject({
    model: tokenFactoryModel(id),
    schema: replyIntelSchema,
    prompt: `A wedding vendor ("${c.vendorName}") replied. Classify it.\n\nREPLY:\n${c.replyText.slice(0, 6000)}`,
  });
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
error text is kept and counted rather than collapsed to a rate — the two distinct failures below
are two different problems wearing one number. Over thirty structured-output calls each:

```text
Qwen/Qwen3-235B-A22B-Instruct-2507    0/30 failed
deepseek-ai/DeepSeek-V4-Flash         4/30 failed (13%)
  2× "the model did not return a response"
  2× "could not parse the response"
```

**A call that never returns an object is not a wrong answer, it is no answer.** Averaged into an
accuracy score it reads as a tie, because there is nothing there to be wrong. Downstream it is
worse than a wrong answer: the classifier falls back to keywords, the reply is filed on a regex, and
a follow-up chases a vendor who already said yes. The failure rate is not the interesting number.
The interesting number is the zero next to it that an accuracy sweep also reported.

### The judge gets its own env var

[`evals.config.ts`](../../evals/evals.config.ts) is twenty lines, and the whole point is one field:

```ts
export default defineEvalConfig({
  maxConcurrency: 2,
  timeoutMs: 240_000,
  judge: { model: modelFor("judge") },
});
```

`modelFor("judge")` resolves through the registry in [`models.ts`](../../agent/lib/models.ts), where
the judge is a role like any other and, unlike any other, is never the model under test:

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

**Why its own env var rather than inheriting the agent's?** Because the entire purpose of the sweep
is to change the agent's model, and a judge that follows it changes the measuring instrument in the
same command that changes the thing being measured. Set `NEBIUS_MODEL` to a weaker model and the
scores stay flat; set it to a stronger one and everything improves at once, including the parts you
did not touch. `NEBIUS_JUDGE_MODEL` exists so the bar can be moved — deliberately, in its own
commit, as its own decision.

The same pin appears at the two other places a judgement is made.
[`eval-scout.ts`](../../scripts/eval-scout.ts) and [`grade.ts`](../../scripts/grade.ts) both call
`modelFor("judge")` for the vendor verdict, and [`simulate.ts`](../../scripts/simulate.ts) uses it
twice over — once to write the adversarial emails and once to decide whether the defence held, with
the comment `// The attacker is deliberately not the model under test.` Its own summary line records
both sides of that: `attacker ${modelIdFor("judge")} · defender ${modelIdFor("classifier")}`.

Simulation is also where the limits of a judge are stated out loud. The attacker emits a
`true_intent` for every email it writes, and `simulate.ts` reports agreement with those labels as
*advisory only* — they are generated, not ground truth. Accuracy is measured on the human-labelled
set, and a run whose cases are invented fresh each time is not a fixed suite no matter how good the
score looks.

### Ask the judge two questions, not one

Both graders hand the judge a single finding and a `zod` schema with two independent booleans:

```ts
const verdictSchema = z.object({
  real: z.boolean().describe("A real, currently-operating business of this category?"),
  serves_region: z.boolean().describe("Located INSIDE the couple's stated travel radius?"),
  reason: z.string().max(220),
});
```

The reason they are separate is in [`eval-scout.ts`](../../scripts/eval-scout.ts):

```ts
// Two independent failures with very different severity: an invented
// vendor is a fabrication, a vendor 20 minutes past the radius is a
// judgement call. Scoring them as one number hid which was happening.
```

**A combined score is a score you cannot act on.** One of those failures means the model made a
business up; the other means a real florist is a little further away than the couple said they would
drive. Collapsed into one percentage they are indistinguishable, and the fix for each is a different
change to a different file. The judge is also told, at length, not to fail a vendor merely for being
in a different town — an instruction added because that is exactly what it did.

Neither script judges everything. Both take `list.slice(0, 4)` per category, and the comment says
why: to keep the eval affordable. That is a sampling bias stated in the source rather than a
methodology hidden in a footnote.

### One grader, two architectures

[`evals/harness/types.ts`](../../evals/harness/types.ts) defines a `RunResult` — the run's status,
its wall clock, one `AgentFacts` per agent, and findings by category. Both implementations write it,
and [`grade.ts`](../../scripts/grade.ts) is the only thing that turns one into a score:

```ts
async function grade(run: RunResult): Promise<Scorecard> {
```

It reads `run.system` to print a label and never branches on it. Two committed runs of the same
fixed brief, read out of [`runs/`](../../runs/):

```text
runs/eve-boston-boho.json   | eve-vercel v18       | 6 agents | 113955ms | waiting   | 14 vendors
runs/graph-boston-boho.json | langgraph-nebius 0.1.0 | 7 agents |  55571ms | completed | 19 vendors
```

Neither line is a result. They are inputs — the collectors that produce them do no grading at all,
which is the property that matters, because a collector that scores its own stack is a collector
with an opinion. **Two graders that "do the same thing" is how a comparison quietly becomes
marketing.** One grader, one contract, one set of briefs; the stack is a string.

### The eval that spends money is a different kind of eval

`eval:replies`, `models:compare` and `probe:schema` are fixed sets against one function call.
[`eval-scout.ts`](../../scripts/eval-scout.ts) drives real planning turns against a running Venus,
and almost everything hard about it is about *when to read the result*:

```ts
// The parent turn settles as soon as Venus has dispatched her scouts — she
// parks while they work. Grading here measured a run in flight and scored
// "0 recorded" against specialists that were still searching. Wait for the
// tree to go quiet before reading anything.
```

It then polls the trace tree every fifteen seconds until no child is `active`, bounded by
`EVAL_SETTLE_TIMEOUT_MS`. A second trap sits just above it: the eval nudges up to three times if it
sees no delegation, and

```ts
// eve 0.24.4 does not deliver `subagent.called` on the parent stream, so
// counting it here made this eval think nothing was delegated and
// re-prompt — triggering a whole extra fan-out per nudge. Count the
// delegation request instead, where it is actually observable.
```

**An eval that measures the system wrong is more expensive than no eval.** Both of those bugs
produced a number: one scored a healthy run at zero, the other tripled the cost of every run it
graded. Neither threw.

What that eval caught is the second decision this recipe is built on. The specialist tier was moved
to a cheaper model:

```text
eval:scout · boston-boho | candidate 10/22 (45%) | baseline 46/50
10/10 specialist sessions failed · not one recorded a vendor
```

The model was not the whole cause. The subagent carried an `outputSchema` added to guarantee a
structured return, and eve escalates a schema the model cannot produce to
`OUTPUT_SCHEMA_NOT_FULFILLED`, which fails the entire child session — several specialists died
before searching once. Reverting the model and deleting the `outputSchema` gave 33/37, then 52/53
after the next fix. The schema was redundant anyway: findings reach the planner through the research
store, never through the child's return value.

**Two changes landed in that one run, and the score could not tell them apart.** A single number
said the candidate failed; only reading the child sessions said which half of the change did it.
That is not an argument against the eval — it is the argument for keeping the failure text, which is
why `probe:schema` counts error strings and `grade.ts` carries the judge's `reason` into every
failing case note.

### What this suite still cannot tell you

The planner — the role that writes every word the couple reads — has no eval that measures its
prose or its orchestration. [`models.ts`](../../agent/lib/models.ts) says so in the role itself:
held constant until an eval can measure the swap. The one role where quality outranks price is the
one role chosen without a measurement.

The scout role was never selected by a sweep either. It was argued for on input price and context
length, then *vetoed* by `eval:scout`. A veto is a weaker instrument than a comparison, and the
rationale in `models.ts` says what to do about it: re-test any candidate with `npm run eval:scout`
before it takes the role.

And the two `RunResult` files in [`runs/`](../../runs/) are committed; no scorecard from
`npm run grade` over them is. The contract that makes the comparison fair exists and has not yet
been used to publish a comparison.

Three briefs. Fifteen replies. Four sampled vendors per category. Nothing geocodes, so the radius
judge reasons about a drive it cannot measure. Each of those is a real ceiling on what any number
in this repository means, and listing them is cheaper than defending a figure that was never that
strong.

### Taking it somewhere that is not a wedding

The point is not weddings specifically. This pattern transfers to any domain where a model returns
structured output over untrusted text and something downstream acts on it: a claims-triage pipeline
turning adjuster notes into a decision code, a support router assigning tickets to queues, an
invoice extractor pulling line items out of supplier PDFs, a compliance reader classifying clauses
in a contract. All four have the same two axes and the same trap. Accuracy is easy to measure and
easy to over-trust; schema reliability is invisible until a downstream fallback quietly answers on
the model's behalf. Hold one labelled set constant across every candidate, count a fallback as a
loss, run more than once and rank on the worst run, and give whatever grades the output a name and
an env var of its own. The domain decides what the labels mean. It does not change that a model can
be right every time it answers and still refuse to answer.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| A candidate wins a sweep, then fails the same cases on the next run | One pass over fifteen cases cannot separate two models near the top | `COMPARE_ROUNDS` defaults to 3 and ranking is on the worst round ([`compare-models.ts`](../../scripts/compare-models.ts)) |
| Accuracy looks unchanged but replies are misfiled in production | The model returned no object and the production keyword fallback answered instead | Score `via === "model"` only; measure the shape separately with `npm run probe:schema` |
| Two models tie on accuracy and one is far worse in use | An accuracy score cannot see a call that returns nothing — there is nothing to be wrong | The probe counts objects, not answers, and keeps each error string ([`probe-structured-output.ts`](../../scripts/probe-structured-output.ts)) |
| Every score moves after a model swap, including untouched cases | The judge inherited the agent's model | `judge: { model: modelFor("judge") }` on its own `NEBIUS_JUDGE_MODEL` ([`evals.config.ts`](../../evals/evals.config.ts)) |
| `eval:scout` reports `0 recorded` for every specialist | The parent turn settles when scouts are dispatched, not when they finish | Poll the trace tree until no child is `active`, bounded by `EVAL_SETTLE_TIMEOUT_MS` |
| One eval run triggers several full fan-outs | `subagent.called` never arrives on the parent stream, so the nudge loop re-prompted | Count `actions.requested` entries whose `kind` is `subagent-call` |
| A whole child session fails and records nothing | An `outputSchema` the model could not produce escalates to `OUTPUT_SCHEMA_NOT_FULFILLED` | Delete it; findings reach the planner through the research store, not the return value |
| A live vendor is scored as a dead source | A 403 is bot blocking, not a missing page | `isLive` accepts 403, 405 and 429; `grade.ts` fails only on 404 and 410 |
| An adversarial run reports a breach that did not happen | A regex cannot tell "quoted the attack" from "followed the attack" | A semantic grader is asked whether the agent *acted* on the instruction ([`simulate.ts`](../../scripts/simulate.ts)) |
| A comparison flatters whichever stack you built | Each implementation graded itself | One `RunResult` contract, one `grade.ts`, identical fixed briefs ([`harness/types.ts`](../../evals/harness/types.ts)) |
| A sweep reports `$0` for a candidate | The id is missing from the catalog price snapshot | Both scripts `skip` an unpriceable model rather than reporting it as free |

## Test it

```bash
npm run eval:all   # test:guards · eval:replies · simulate · eval:scout · eve eval --tag fast
```

That chain ends by driving real planning turns against the deployed agent, so it spends research
credits and takes minutes, not seconds — `npm run eval:replies` alone is the fast half.

What the suite guarantees is a property, not a score. Every script that prints a number also prints
the model that produced it and, where a judgement was involved, the model that graded it — and those
two are never the same id. The labelled set is checked into the repository, so a score is
reproducible against the exact cases that produced it; the adversarial set is not, and says so in
its own output. No number in this recipe is a badge, and the suite has no pass threshold: it exists
to make a swap arguable, not to declare one safe.

## Going further

- **Raise the rounds before you trust a winner.** `COMPARE_ROUNDS` and `PROBE_ROUNDS` are env vars
  precisely so the cost of certainty is a dial. The default of three came from a model that needed
  exactly two runs to disqualify itself.
- **Probe every model in a structured-output role, not just the suspect.** `probe:schema` with no
  arguments measures the models currently serving the classifier, scout and judge roles — the
  incumbent is a candidate too, and an incumbent nobody re-measures is an assumption.
- **Give the planner an eval before you swap it.** It is roughly 15% of a plan's cost and 100% of
  what the couple reads, and [`synthesis.eval.ts`](../../evals/synthesis.eval.ts) is the closest
  thing to a model for one: a full turn, a hard assertion that every presented total fits the
  budget, and a judged rubric on top.
- **Publish the scorecard, not only the runs.** [`runs/`](../../runs/) holds a `RunResult` per
  system per brief and `npm run grade` will score them with identical code. Until that output is
  committed, the fairness of the comparison is a design property rather than a published one.
- **Read the decision record this was built from.**
  [`decisions.json`](../../evals/data/decisions.json) and the generated
  [engineering log](../../docs/engineering-log.md) carry both faults with dates, commits and run
  ids — including the sweep that recommended the wrong model.

## License

Unset — this repository carries no LICENSE file, so no reuse rights are granted by default.
