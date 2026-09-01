# Evaluation — Hold the Set, Pin the Judge

> The correctness of the content and the reliability of the shape are two different measurements. Measure both.

Recipe **09 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → Governance → Cost → Latency → Observability → **Evaluation** → Verification

On 2026-08-29 the sweep ran five candidates for the vendor-reply classifier. Each candidate made
one pass over the same fifteen human-labelled replies. [`models.ts`](../../agent/lib/models.ts)
records the results:

```text
deepseek-ai/DeepSeek-V4-Flash        100%   $0.0020   1570ms
Qwen/Qwen3-235B-A22B-Instruct-2507   100%   $0.0023   1203ms
zai-org/GLM-5.3-Flash                 93%   $0.0041   2633ms
nvidia/Nemotron-3_5-Lightning         80%   $0.0077   6613ms
Qwen/Qwen3-30B-A3B-Instruct-2507      73%   $0.0013   1851ms
```

The team switched the classifier to the model at the top of that table. The next run of the same
fifteen cases scored 11/15. In six of those cases, the model returned no object.

The prices are not the important column. The important fact is different. The sweep had a
ground-truth label on every case, ran correctly, and used a set that did not change. The sweep
still recommended the wrong model, because the sweep answered a narrower question than the
intended question. Both faults below are dated entries in
[`decisions.json`](../../evals/data/decisions.json), which generates the
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

- `NEBIUS_API_KEY` — every script here makes real Token Factory calls. No script mocks a model.
- Node 24 — `package.json` declares `engines.node: "24.x"`. Run `npm install` at the repo root.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — these are optional. Without them, the scripts print a
  note, skip the `/observe` summary, and do not fail.
- `LANGSMITH_API_KEY` — this is optional. With it, `eval:replies` also files the same run as a
  LangSmith experiment.
- Complete Recipe 01 (Foundation) first. The judge is a role in the registry. The pin has meaning
  only after roles exist.

## Run it

```bash
npm install
PROBE_ROUNDS=1 npm run probe:schema -- \
  Qwen/Qwen3-235B-A22B-Instruct-2507 deepseek-ai/DeepSeek-V4-Flash
```

The probe prints one character per call: `.` for an object, and `x` for nothing. The output below
is from 2026-08-30:

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

This is one round on one day. On the day before, the same script measured the same model at 4
failures in 30. The movement of the number is the finding. Twelve of those fifteen calls returned
no object, so no downstream check has an answer to grade. An accuracy sweep that credits the
production fallback scores that result as a tie with the line above it.

`probe:schema` with no arguments measures the registry defaults for the classifier, scout, and
judge roles. It does not measure an env override. `PROBE_ROUNDS` defaults to 2, and
`COMPARE_ROUNDS` defaults to 3, for the reason above.

## Walk-through

### The set does not move

[`evals/data/vendor-replies.json`](../../evals/data/vendor-replies.json) contains fifteen replies.
Each reply has a human-labelled `expected` intent, from the seven intents that the classifier can
return. The case names show what each case tests: `conditional-not-decline`,
`quoted-reply-thread`, `malformed-html-reply`, `injection-in-reply`, `other-auto-reply`. Three
scripts read that one file. [`eval-replies.ts`](../../scripts/eval-replies.ts) scores the
production classifier on it. [`compare-models.ts`](../../scripts/compare-models.ts) runs the same
cases and overrides `modelId` for each candidate.
[`probe-structured-output.ts`](../../scripts/probe-structured-output.ts) reuses the reply texts
and ignores the labels.

**The eval calls the shipped function, not a copy of it.** `eval-replies.ts` imports `classifyReply`
from [`classify.ts`](../../agent/lib/classify.ts).
[`inbound-email.ts`](../../agent/channels/inbound-email.ts) calls the same function when a real
vendor replies. Both use the same prompt, the same precedence rules, and the same injection
warning. An eval that reimplements the measured function grades a second implementation. The two
implementations drift when somebody edits one prompt.

**Fifteen cases is a small set, and the source code says so.** The comment above `ROUNDS`
in `compare-models.ts` states the limit: one pass over fifteen cases can only remove the clearly
worse candidates. Everything below follows from that sentence.

### Count the fallback as a loss, then rank on the worst round

`classifyReply` uses a keyword heuristic when the model is not reachable, because in production a
classification failure must never lose a vendor's reply. In a sweep, that same behaviour gives a
false result. `DECLINE_HINTS` matches, among others, `unavailable|already booked|unsubscribe|not interested`. A
model that returns nothing can then get cases correct by accident.

```ts
// A heuristic fallback means the model failed to return the schema —
// that is a failure of this candidate, not a free pass.
if (via === "heuristic") fallbacks += 1;
const ok = intent === c.expected && via === "model";
```

`via === "model"` is the necessary half of that condition. Without it, the score measures the
model together with its fallback. That combination is correct to ship and incorrect to compare.

```ts
const ROUNDS = Number(process.env.COMPARE_ROUNDS ?? 3);
// …
rows.sort((a, b) => b.worstScore - a.worstScore || b.score - a.score || a.costUsd - b.costUsd);
// …
// A candidate has to be perfect in EVERY round to be considered — one bad
// round out of three is exactly the signal a single pass would have hidden.
const cheapestPerfect = rows.filter((r) => r.worstScore === 1).sort((a, b) => a.costUsd - b.costUsd)[0];
```

**The incorrect method is a rank on the mean.** A mean mixes a bad round into a good round,
reports a number that no run produced, and recommends a model that already failed. The primary
sort key is `worstScore`, and cost is only the third tiebreak, so a cheap candidate cannot pass a
bad round. The script also does not close the argument. Its recommendation line tells you to run
the sweep one more time. A model that wins one sweep and fails the next is the exact failure that
the harness must catch.

### The probe asks a question accuracy cannot

[`probe-structured-output.ts`](../../scripts/probe-structured-output.ts) has seventy-five lines,
and this script settled the question:

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

The script contains no `expected` field. The only question is whether an object comes back. The script counts the error text for each distinct message. It does not collapse the errors into one rate, because one rate hides two different problems in one number. Each model then ran thirty
structured-output calls:

```text
Qwen/Qwen3-235B-A22B-Instruct-2507    0/30 failed
deepseek-ai/DeepSeek-V4-Flash         4/30 failed (13%)
  2× "the model did not return a response"
  2× "could not parse the response"
```

**A call that returns no object is not a wrong answer; it is no answer.** An accuracy score
averages that call as a tie, because no content exists to be wrong. Downstream, the result is
worse than a wrong answer. The classifier falls back to keywords and files the reply with a regex
match. The agent then sends a follow-up to a vendor who already agreed. The important number is
not the failure rate but the zero beside it, which the accuracy sweep also reported.

### The judge gets its own env var

[`evals.config.ts`](../../evals/evals.config.ts) has twenty lines, and one field is the point:
`judge: { model: modelFor("judge") }`, the shared default for every eve eval. The field resolves
through the registry in [`models.ts`](../../agent/lib/models.ts). There the judge is a role like
the other roles, but the judge is never the model under test:

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

**Why does the judge get its own env var and not the agent's env var?** The purpose of a sweep is
a change to the agent's model. A judge that follows the agent's model moves the measuring
instrument in the same command that moves the measured system. If the judge inherited
`NEBIUS_MODEL`, a stronger model would lift every score at once, including untouched parts of the
system. `NEBIUS_JUDGE_MODEL` exists so that the grading standard changes deliberately, in its own
commit, as its own decision.

The pin applies at every other judgement. [`eval-scout.ts`](../../scripts/eval-scout.ts) and
[`grade.ts`](../../scripts/grade.ts) both call `modelFor("judge")` for the vendor verdict.
[`simulate.ts`](../../scripts/simulate.ts) uses the judge twice. The judge writes the adversarial
emails (`// The attacker is deliberately not the model under test.`), and the judge decides
whether the defence held. Its summary line records both sides: `attacker ${modelIdFor("judge")} · defender
${modelIdFor("classifier")}`.

The simulation also states the limits of a judge. The attacker labels its own emails with a `true_intent`. `simulate.ts` reports agreement with those labels as *advisory only*, because the labels are generated and are not ground truth. A suite that invents fresh cases on every run
is not a fixed set, even when the score looks good.

Ask a pinned judge two questions, not one. Both graders give the judge one finding and two booleans. This is the schema in [`grade.ts`](../../scripts/grade.ts), and `eval-scout.ts` carries an almost identical schema:

```ts
const verdictSchema = z.object({
  real: z.boolean().describe("A real, currently-operating business of this category?"),
  serves_region: z.boolean().describe("Located INSIDE the couple's stated travel radius?"),
  reason: z.string().max(220),
});
```

**A blended score is a score that you cannot act on.** The comment above the call site in
`eval-scout.ts` gives the reason. An invented vendor is a fabrication. A vendor twenty minutes
past the radius is a judgement call. One blended number hid which fault occurred. The fix for
each fault is a different change to a different file.

Neither script judges everything. Both take `list.slice(0, 4)` per category to keep the eval
affordable. The source code declares this sampling bias and does not hide it in a methodology
note.

### One grader, two architectures

[`evals/harness/types.ts`](../../evals/harness/types.ts) defines a `RunResult`: status, wall
clock, one `AgentFacts` per agent, and findings by category. Both implementations write a
`RunResult`, and [`grade.ts`](../../scripts/grade.ts) is the only code that turns one into a
score. The grader reads `run.system` to print a label and never branches on it. These are two
committed runs of the same fixed brief, read from [`runs/`](../../runs/):

```text
runs/eve-boston-boho.json   | eve-vercel v18         | 6 agents | 113955ms | waiting   | 14 vendors
runs/graph-boston-boho.json | langgraph-nebius 0.1.0 | 7 agents |  55571ms | completed | 19 vendors
```

Neither line is a result. The lines are inputs, and the collectors that write them do no grading.
That property matters, because a collector that scores its own stack has an opinion. **Two graders
that "do the same thing" turn a comparison into marketing.** The system uses one contract, one
grader, and one set of briefs. The stack is only a string.

### The eval that spends money is a different kind of eval

The three evals above run fixed sets against one function call.
[`eval-scout.ts`](../../scripts/eval-scout.ts) drives real planning turns against a running
Venus. The hard part is to know *when* to read the result. The comments in the script record two
of its own bugs.

First, Venus parks at the moment she dispatches her scouts. An early read then scored `0 recorded`
against scouts that were still searching. Second, the nudge loop counted `subagent.called`, which
eve 0.24.4 never delivers on the parent stream. The loop concluded that no delegation occurred and
caused one extra full fan-out per re-prompt. **An eval that measures the system incorrectly costs
more than no eval.** Neither bug caused an exception.

The script caught the second decision that this recipe is built on. A commit moved the scout tier
to a cheaper model, and the decision record for that run reads:

```text
eval:scout · boston-boho | DeepSeek-V4-Flash in the scout role: 10/22 (45%)
10/10 specialist sessions failed · not one recorded a vendor
```

The model was not the whole cause. The scout carried an `outputSchema`, added to guarantee a
structured return. When the model cannot produce the schema, eve escalates the fault to
`OUTPUT_SCHEMA_NOT_FULFILLED` and fails the full child session, so several scouts failed before
one search. A revert of the model and a deletion of the schema gave 33/37, then 52/53 after the
next fix. The schema was also redundant. Findings reach the planner through the research store,
never through the child's return value.

**Two changes landed in that run, and one number could not separate them.** The score said that
the candidate failed. The decision record names two causes, and only one cause was the model.
This is the argument for failure text beside the score. For that reason, `probe:schema` counts
error strings, and `grade.ts` carries the judge's `reason` into the note for the failing case.

### What this suite still cannot tell you

The planner writes every word that the couple reads. No eval measures its prose or its
orchestration. [`models.ts`](../../agent/lib/models.ts) says this in the role itself: the model
stays constant until an eval can measure the swap. Quality outranks price for this one role, and
this one role has no measurement behind its selection.

A sweep did not select the scout role either. The arguments for it were input price and context
length, and then `eval:scout` *vetoed* it. A veto is a weaker instrument than a comparison. The
rationale gives the correction: test each candidate with `npm run eval:scout` before it takes the
role.

The suite has three briefs, fifteen replies, and four sampled vendors per category. The
repository holds both `RunResult` files, and no scorecard covers them. The radius judge reasons
about a drive that it cannot measure. The write boundary now measures the straight-line distance
itself, so the judge gives the second opinion on that question. These limits apply to every
number here. A list of the limits costs less than a defence of a weak figure.

### Taking it somewhere that is not a wedding

The point is not weddings. This pattern transfers to each domain where a model returns structured
output from untrusted text and a downstream system acts on the output. Four examples follow. A
claims-triage pipeline turns adjuster notes into a decision code. A support router assigns
tickets to queues. An invoice extractor pulls line items from supplier PDFs. A compliance reader
classifies contract clauses.

All four domains have the same two measurements and the same trap. Accuracy is easy to measure
and easy to trust too much. Schema reliability stays invisible until a downstream fallback
answers in place of the model.

Hold one labelled set constant across every candidate. Count a fallback as a loss. Run the sweep
more than one time. Rank the candidates on the worst run. Give the grader a name and its own env
var. The domain decides what the labels mean. The domain does not change one fact: a model can be
correct each time it answers and can still refuse to answer.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| A candidate wins a sweep, then fails the same cases on the next run | One pass over fifteen cases cannot separate two models near the top | `COMPARE_ROUNDS` defaults to 3 and ranking is on the worst round ([`compare-models.ts`](../../scripts/compare-models.ts)) |
| Accuracy looks unchanged but replies are misfiled in production | The model returned no object and the production keyword fallback answered instead | Score `via === "model"` only, and measure the shape separately with `npm run probe:schema` |
| Two models tie on accuracy and one is far worse in use | An accuracy score cannot see a call that returns nothing — there is nothing to be wrong | The probe counts objects rather than answers, and keeps each error string ([`probe-structured-output.ts`](../../scripts/probe-structured-output.ts)) |
| Every score moves after a model swap, including untouched cases | The judge inherited the agent's model | `judge: { model: modelFor("judge") }` on its own `NEBIUS_JUDGE_MODEL` ([`evals.config.ts`](../../evals/evals.config.ts)) |
| `eval:scout` reports `0 recorded` for every specialist | The parent turn settles when scouts are dispatched, not when they finish | Poll until every dispatched scout has registered *and* every child is `completed` or `failed`, bounded by `EVAL_SETTLE_TIMEOUT_MS` |
| One eval run triggers several full fan-outs | `subagent.called` never arrives on the parent stream, so the nudge loop re-prompted | Count `actions.requested` entries whose `kind` is `subagent-call` |
| A whole child session fails and records nothing | An `outputSchema` the model cannot produce escalates to `OUTPUT_SCHEMA_NOT_FULFILLED` | Delete it; findings reach the planner through the research store, not the return value |
| A live vendor is scored as a dead source | A 403 is bot blocking, not a missing page | `isLive` accepts 403, 405 and 429; `grade.ts` fails only on 404 and 410 |
| An adversarial run reports a breach that did not happen | A regex cannot tell "quoted the attack" from "followed the attack" | A semantic grader is asked whether the agent *acted* on the instruction ([`simulate.ts`](../../scripts/simulate.ts)) |
| A comparison flatters whichever stack you built | Each implementation graded itself | One `RunResult` contract, one `grade.ts`, identical fixed briefs ([`harness/types.ts`](../../evals/harness/types.ts)) |

## Test it

```bash
npm run eval:all   # test:guards · eval:replies · simulate · eval:scout · eve eval --tag fast
```

That chain ends with real planning turns against the deployed agent. The chain spends research
credits and takes minutes. `npm run eval:replies` alone is the fast half.

The suite guarantees a property, not a score. Every eval script that prints a score also prints
the model that produced the score. Where a judgement was involved, the script also prints the
model that graded it. By default, those two ids are never the same. `grade.ts` writes its judge
to the summary and not to stdout. The repository holds the labelled set, so you can reproduce a
score against the exact cases that produced it.

The adversarial set is not in the repository, and its own output says so. There is no badge and
no pass threshold. The suite exists to make a swap arguable, not to declare a swap safe.

## Going further

- **Raise the rounds before you trust a winner.** `COMPARE_ROUNDS` and `PROBE_ROUNDS` are env
  vars, so you can adjust the cost of certainty. The comment directly above the default of three gives its reason. A model won a single-pass sweep at 15/15, then scored 11/15 on the next run of the same cases.
- **Probe the incumbent, not only the suspect.** `probe:schema` with no arguments measures the
  registry defaults for the classifier, scout and judge roles. An incumbent that nobody measures
  again is an assumption, not a measurement.
- **Give the planner an eval before you swap it.** The registry comment puts the planner at 15%
  of a plan's cost, and no eval measures that share. The planner also produces 100% of what the
  couple reads. [`synthesis.eval.ts`](../../evals/synthesis.eval.ts) is the nearest example of
  such an eval: a full turn, a hard assertion that every presented total fits the budget, and a
  judged rubric over that.
- **Publish the scorecard, not only the runs.** [`runs/`](../../runs/) holds one `RunResult` for
  each system and brief, and `npm run grade` scores them with identical code. Until you commit
  that output, the fairness of the comparison is a design property and not a published property.
- **Next: [Verification — Assert Against the Deployed Artifact](../10-assert-against-the-deployed-artifact/).**
  A score is only as true as the artifact that produced it. The last recipe covers the gap
  between a check that passes locally and a build that behaves correctly in production.

## License

Unset — this repository has no LICENSE file, so the default grants no reuse rights.
