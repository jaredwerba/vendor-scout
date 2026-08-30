<h1 align="center">Venus Blueprint Recipes</h1>

<p align="center">
  <strong>Ten things a wedding-planning agent taught, extracted so they transfer to a domain that is not weddings.</strong>
</p>

---

Venus is a production agent: it researches real vendors, emails real strangers, files their replies, and bills a real account. It has been wrong in public more than once. This cookbook is the residue — each recipe is one fault the system actually hit, the change that fixed it, and the rule that generalizes.

It is for engineers who have an agent working on their machine and want to know what the gap looks like between that and something that can be left running.

**What is different about these recipes.** They are not clone-and-run samples. Every one points at code in this repository that is deployed and serving, so the walk-throughs cite real files at real paths and the commands under **Run it** run the actual system. Nothing here is a toy reconstruction of a lesson — it is the lesson where it lives.

**Every recipe is grounded.** Each one is built from an entry in [`evals/data/decisions.json`](../evals/data/decisions.json), the dated record of what broke and why, which also generates [`docs/engineering-log.md`](../docs/engineering-log.md). A recipe cannot claim a result the record does not contain.

**What these faults have in common:**

- Not one of them announced itself. No crash, no stack trace, no red build.
- Costs that were always zero, then costs that were plausibly wrong by a factor of two.
- An event the documentation promises and the runtime never sends.
- A page section present in development and absent in production.
- A dashboard reporting a model that had been reverted hours earlier.
- Ten of ten sub-agents dying inside a build that passed.

**The failures that cost the most are the ones that look like success.** That is the thesis, and it is why every recipe ends with a failure-modes table rather than a benchmark.

The recipes are a **sequence**. They form an arc — Foundation → Delegation → Durability → Guards → Governance → Cost → Latency → Observability → Evaluation → Verification — and each assumes the one before it. You can read any of them alone; the prose is written for someone going in order.

## Recipes

<!-- BEGIN:RECIPES -->

| # | Recipe | Stack | Difficulty | Reading |
| --- | --- | --- | --- | --- |
| 01 | [Foundation — Route a Model per Job](./01-route-a-model-per-job/) | `nebius-token-factory` `typescript` `ai-sdk` `eve` `next` `zod` `node` | beginner | 9 min |
| 02 | [Delegation — Give the Specialist a Smaller Tool Surface](./02-a-smaller-tool-surface/) | `eve` `nebius-token-factory` `typescript` `next` `zod` `tavily` `upstash` `jq` | intermediate | 9 min |
| 03 | [Durability — Record Findings as You Find Them](./03-record-findings-as-you-find-them/) | `eve` `next` `nebius-token-factory` `upstash-redis` `typescript` `tavily` `langsmith` `vercel` | intermediate | 9 min |
| 04 | [Guards — Refuse in the Tool, Not in the Prompt](./04-refuse-in-the-tool/) | `eve` `typescript` `zod` `nebius-token-factory` `next` `tavily` `upstash` `vercel` | intermediate | 9 min |
| 05 | [Governance — Budget the Retrieval](./05-budget-the-retrieval/) | `eve` `nebius-token-factory` `tavily` `typescript` `zod` `next` `upstash` | intermediate | 11 min |
| 06 | [Cost — Compute the Price, Then Distrust It](./06-compute-the-price-then-distrust-it/) | `nebius-token-factory` `eve` `typescript` `next` `upstash-redis` `vercel` | advanced | 12 min |
| 07 | [Latency — Spend Round Trips, Not Calls](./07-spend-round-trips-not-calls/) | `eve` `nebius-token-factory` `tavily` `typescript` `zod` `next` `upstash` `vercel` | intermediate | 11 min |
| 08 | [Observability — A Dashboard That Cannot Lie](./08-a-dashboard-that-cannot-lie/) | `eve` `typescript` `langsmith` `opentelemetry` `next` `upstash-redis` `nebius-token-factory` `vercel` | advanced | 12 min |
| 09 | [Evaluation — Hold the Set, Pin the Judge](./09-hold-the-set-pin-the-judge/) | `nebius-token-factory` `eve` `typescript` `ai-sdk` `zod` `langsmith` `upstash-redis` | advanced | 13 min |
| 10 | [Verification — Assert Against the Deployed Artifact](./10-assert-against-the-deployed-artifact/) | `eve` `next` `typescript` `nebius-token-factory` `vercel` `playwright` `node` | advanced | 12 min |

<!-- END:RECIPES -->

## The blueprint they came from

| Blueprint | Stack | Integrations | Live |
| --- | --- | --- | --- |
| [Venus — Wedding Planning Agent](../README.md) | `eve` `next` `nebius-token-factory` `tavily` `langsmith` `upstash` `resend` `vercel` | `nebius` `tavily` `langsmith` `resend` `upstash` | [vendor-scout-xi.vercel.app](https://vendor-scout-xi.vercel.app) |

A recipe teaches one idea. The blueprint is the finished application those ideas add up to — a planner that fans out specialists, verifies what they find, emails the vendors, files the replies, and reports what it spent.

## Taking these to another domain

The wedding is incidental. What makes the domain interesting is structural, and the same structure shows up elsewhere:

- **Findings that must be verified before they are acted on.** A vendor's email address here; a citation, a part number, a case reference, a supplier quote elsewhere.
- **An irreversible action at the end.** Sending an email. Filing a ticket, placing an order, publishing a post, paying an invoice.
- **A live corpus with no ground truth.** Nothing to fine-tune against and nothing to look up — only the open web and a judgement about whether an answer is real.
- **A user who will walk away mid-task** and expect the work to still be there.

Any domain with those four properties will hit most of these ten faults. A casting agent, a location scout, a grant-matching service, a procurement assistant, a travel planner, a talent booker — the guards change shape, the failure modes do not.

Each recipe closes by naming what transfers and what does not.

## House style

The structure of these recipes — the eyebrow, the arc chain, the story triple, the failure-modes table, the rule that findings are design rationale rather than a benchmark — is modelled on the [Agent Blueprint Recipes](https://github.com/nebius/nebius-partner-cookbook) published by Nebius, and [`schema/recipe.schema.json`](./schema/recipe.schema.json) mirrors theirs so a recipe written here validates against the same contract.

Regenerate the table above after editing any `recipe.json`:

```bash
node scripts/build-cookbook-readme.mjs          # rewrite
node scripts/build-cookbook-readme.mjs --check  # fail if it has drifted
```

## License

Unset. This repository carries no LICENSE file, so no reuse rights are granted by default — add
one before publishing if you intend others to build on this.
