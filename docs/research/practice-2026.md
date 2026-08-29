# What current practice says, and where Venus already agrees

Research notes, August 2026. The value here is not the survey — it is the
handful of published findings that either **confirm something this project
discovered by running it**, or **name a gap it still has**.

## Confirmed independently

**The constraint tax.** *Constraint Tax in Open-Weight LLMs* (arXiv 2606.25605,
2026-06-24): when tool calling and JSON-Schema constraints are enabled
**simultaneously**, multiple open-weight models **stop invoking tools entirely**
while still reporting high schema compliance. The mechanism is that schema
constraints compile into grammar-based token masks that make tool-call tokens
unreachable. Both features work fine in isolation.

That is precisely what happened here. The scout carried an `outputSchema`
*and* a tool surface; on DeepSeek-V4-Flash it stopped calling `record_vendor`
and went straight for the final report, which it then could not produce —
10 of 10 sessions dead. Deleting the schema fixed it. The paper's closing
warning is the same sentence this log arrived at from the other direction:
*"evaluating tool use and structured output separately may overlook important
reliability issues in production."*

Related, and another reason the schema had to go: on Anthropic's API,
structured outputs **block prompt caching entirely**.

**Price per token is a poor predictor of price per task.** Cognition,
*Making Fable Cheaper Than Opus* (2026-07-13): the pricier model was cheaper
per resolved task because it needed 11.5 turns where the cheaper one needed
26.5. Venus measured the same shape on a different axis —
Nemotron-3.5-Lightning is the cheapest model in the Token Factory catalog per
token ($0.06/$0.24) and was the **most expensive per run** and five times
slower, because output volume is what you pay for.

**Simulated users are "easy mode."** *Mind the Sim2Real Gap* (arXiv
2603.11245, 451 human participants, 31 simulators): simulated users are
excessively cooperative and stylistically uniform, and **higher model
capability does not yield more faithful simulation**. The adversarial
simulation here is already labelled advisory for the same reason — its
attacker generates its own labels, so only "did the defence hold" is scored.

## Named gaps this project still has

**The judge is uncalibrated.** *Reliability without Validity* (arXiv
2606.19544, 21 judges, 9 providers): the gap between raw agreement and
Cohen's κ is **33–41 points**, so reporting agreement massively overstates
judge quality; and judge rankings shift by up to 14 positions depending on
the benchmark. Position bias affects pointwise scoring too, not just pairwise
— fixed by averaging a few random order permutations.

Venus reports judge verdicts on "is this a real business" and "is it inside
the radius" with no calibration against human labels at all. The published
workflow is specific: 30–50 balanced examples per class, **TPR and TNR both
above 90%**, Rogan–Gladen correction to recover the true rate, bootstrap CIs.

**Single runs overstate.** The reporting standard is **pass^k**, not pass@k:
at 75% per-trial success, pass^3 is about 42%. Every score in this log is a
single run.

**Retries must start clean.** *Why Retrying Fails: Context Contamination*
(arXiv 2605.08563): a failed attempt left in context makes the retry about
**7.1x more error-prone**; on SWE-bench Verified the naive model predicts
98.6% pass@3 and reality delivers 81.2%. Venus's category re-run happens to
be clean — a re-run scout is a fresh session — but that is currently an
accident of the architecture rather than a stated invariant.

**A shared corpus is a poisoning surface.** *Utility Under Attack* (arXiv
2608.21230): poisoning **1.2%** of a memory corpus with plainly-worded false
assertions dropped accuracy from 0.850 to 0.300, and a four-stage write-time
content screen rejected **zero of 360** poisoned memories — content-only
screening cannot distinguish false from true without external context.

This matters directly, because the cross-session vendor corpus is the next
thing to be built. Reusing a previously-verified vendor is the whole point,
and it is also the attack: one bad entry propagates into every future plan
for that region. Provenance and re-verification have to be designed in, not
added later.

## Two rules worth adopting wholesale

**Make the deterministic gate the only release condition; the LLM judge is
advisory.** Self-correction helps roughly in proportion to how verifiable the
task is: +17.4pp where constraints are checkable, +1.6pp where they are not,
with up to 13.25% correct→wrong regression. Spotify's shipped design is the
model — verifiers chosen by codebase contents, regex-extract only the relevant
error lines, and the agent sees pass/fail plus those lines and nothing about
the verifier's internals.

Venus already does the structural half of this: sources, emails, locations
and reachability are checked in code, and only "is this real / is it in
range" is judged. Worth stating as the rule rather than leaving implicit.

**Per-action human approval is not a control.** A planted dangerous command
was caught by human reviewers **13.6%** of the time. The design rule that
replaced it is risk-tiered autonomy — full autonomy for reversible work,
post-hoc review and undo for recoverable work, and blocking approval reserved
for the irreversible. Sending an email to a stranger is irreversible, which is
where an approval gate actually belongs.
