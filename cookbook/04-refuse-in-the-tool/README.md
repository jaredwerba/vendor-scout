# Guards — Refuse in the Tool, Not in the Prompt

> Move a broken rule into the tool. Do this only where the tool can check the rule.

Recipe **04 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → **Guards** → Governance → Cost → Latency → Observability → Evaluation → Verification

A scout recorded a caterer with the inquiry address `inquiries@hideseekmedia.com`. The scout took the address from a WeddingWire page for a different business. Venus sends real outreach email to vendors, with the couple as the reply-to address. Thus one more plan could put a wedding inquiry in the inbox of a media company.

The written instructions already forbid both errors. The scout's instructions forbid directory sources. The instructions also require a published address from the vendor's own contact page. The model read the instructions and broke them.

The correction moves the rule from the prompt into `record_vendor`. That tool writes a finding into the research store. This method is correct, and it applies to other rules. But one day later, the same method, applied to a different rule, used the full search budget of a scout to produce one vendor. The decision record reads:

```text
Searches spent on one drive time: 7 | Search budget: 25 of 25 | Vendors recorded: 1
```

That scout was not confused. It obeyed its instructions. The instructions told it to state a drive time for each vendor. But no tool of the scout can produce a drive time.

## What you'll build

```
agent/
  lib/
    vendor-guards.ts             # five checks: directory, foreign email, contact form, liveness, radius
    search-budget.ts             # the cap the counter-lesson exhausted
  subagents/scout/
    instructions.md              # what the model is told — and what it stopped being asked for
    tools/record_vendor.ts       # the write boundary; every guard runs here, before the write
scripts/
  test-vendor-guards.mjs         # the guards against real rows from a real run, with no model
```

## Prerequisites

- Node 24 — `package.json` pins `"node": "24.x"`.
- This repository cloned, and `npm install` run once.
- Network access: the liveness guard sends one real `GET` for each recorded vendor, and the suite fetches live URLs.
- The guard suite needs no model key. The guards are pure functions plus one `fetch`, so they run without an LLM.
- The guard suite needs nothing else. `npm run eval:scout` sends real planning turns to the deployed Venus, or to a local Venus that you select. The model keys and the search keys stay on that deployment, not in `.env.local`.

## Run it

```bash
npm install
npm run test:guards
```

```text
> wedding@0.0.0 test:guards
> node --import ./scripts/ts-resolve.mjs scripts/test-vendor-guards.mjs

✓ want REJECT got REJECT(directory)  American BBQ Catering
✓ want REJECT got REJECT(directory)  Vinwood Caterers
✓ want REJECT got REJECT(directory)  Sydney Smith Designs
✓ want PASS   got PASS               Off the Vine Catering
✓ want PASS   got PASS               The Barn at Gibbet Hill
✓ want PASS   got PASS               Willowdale Estate
✓ want PASS   got PASS               Silver + Salt Photo
✓ want PASS   got PASS               Kreative Expressions
✓ want PASS   got PASS               The Sulls
✓ want PASS   got PASS               Susanne's Weddings Floral Design Studio
✓ want PASS   got PASS               Peppers Artful Events
✓ want PASS   got PASS               Copper Penny Flowers
✓ want PASS   got PASS               Luxe Wedding Co
✓ want PASS   got PASS               Sarah Brides Bridal
✓ want PASS   got PASS               Skylark Farm
✓ want PASS   got PASS               Notyelp Studio
✓ want PASS   got PASS               Gibbet Hill Gallery
✓ want REJECT got REJECT(directory)  Real Knot Listing
✓ want REJECT got REJECT(directory)  Real Wedding.com Listing
✓ want REJECT got REJECT(directory)  Real Maps Listing
✓ want MISSING got MISSING Flowers by Jamie Lynn
✓ want PRESENT got PRESENT Les Fleurs
✓ want PRESENT got PRESENT LW Blooms

vendor guards: all cases behave as intended
```

## Walk-through

### The rule was already written down

[`agent/subagents/scout/instructions.md`](../../agent/subagents/scout/instructions.md) states this rule clearly:

```md
**The email must belong to that business.** Take it from their own contact page. An address
whose domain has nothing to do with the vendor (a marketing agency, a venue you found them
through, a directory) is not their address — record `contact form only` instead. A real
stranger receives whatever you record here.
```

**A repeated rule that the model already broke is not a control.** The instruction stays in place, and it helps. It shapes what the scout looks for during a search. But the instruction cannot decide if a specific finding obeys it. Only a component downstream of the model can decide that. There is exactly one place downstream: the tool that writes.

### The guard runs at the write, not at the read

[`agent/subagents/scout/tools/record_vendor.ts`](../../agent/subagents/scout/tools/record_vendor.ts) checks each finding before it stores the finding. The directory case follows:

```ts
const source = input.source_url ?? "";
const dir = source ? directoryHost(source) : null;
if (dir) {
  return {
    status: "rejected_directory_source",
    note:
      `That source is a ${dir.replace(/\.$/, "")} listing, not ${input.name}'s own site. ` +
      "Open their actual website (search their name plus their town), take the email and " +
      "price signal from there, and record it again with that URL. If they have no site of " +
      "their own, skip them.",
  };
}
```

**A rejection is an instruction, not an error.** The tool returns a machine-readable `status` and a `note` for the model. The note tells the model the next steps: open the vendor's real site, take the email from that site, and record the vendor again. A refusal that only says *no* costs the scout a step and teaches the scout nothing.

**One part of the check order is necessary, and one part is not.** The two checks with the lowest cost run first: is the URL a directory, and is the value a URL. They run before `sourceIsMissing`, which costs one network request. Thus a WeddingWire listing never causes a `GET`. The email check also has no cost, but it runs last, after the fetch. Thus a vendor with a foreign address causes one request before the tool refuses it. No code depends on this order today. Know this before you copy the order.

Two statuses in the same tool are intentionally *not* refusals. When the research store is not available, the tool returns `not_configured`. When a write fails, the tool returns `record_failed`. Both statuses tell the scout to keep the vendor in its final report. A guard rejects a bad finding. An outage must not reject a finding.

### Match on host labels, not on substrings

The first version of the directory check examined the URL string for each of twenty known listing hosts. The docblock in [`agent/lib/vendor-guards.ts`](../../agent/lib/vendor-guards.ts) says:

```
 * Matched on HOST LABELS, not as a substring of the URL. Plain `includes`
 * read "wedding.com" inside `luxewedding.com` and "brides.com" inside
 * `sarahbrides.com`, so a real vendor's own domain was classified as a
 * directory and silently discarded — and a scout has no way to appeal a
 * guard. A share link in a query string (`?share=facebook.com/...`) did the
 * same to a legitimate gallery page.
```

`url.includes("wedding.com")` is the incorrect pattern. Its result is the costly type of failure: a real vendor disappears from the plan with no message, and the model cannot object. The replacement parses the host and matches three declared pattern shapes. The three shapes are a label in the host, a domain suffix on a label boundary, and a host plus a path for `google.com/maps`.

```
directoryHost("https://www.weddingwire.com/biz/barn-at-bradstreet-farm-rowley/db2f55d")  "weddingwire."
directoryHost("https://luxewedding.com/portfolio")                                      null
directoryHost("https://www.barnatgibbethill.com/gallery?share=facebook.com/x")          null
```

Three `PASS` rows in the suite exist only because of that defect: `Luxe Wedding Co`, `Sarah Brides Bridal`, and `Notyelp Studio`. **A guard with no appeal path must be more careful than the model it limits.**

### An address that plausibly belongs to the business

`emailLooksForeign` compares the mail domain with the vendor's website and with the words of the vendor's name. The check returns `false`, a pass, for free mail:

```ts
const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|aol|icloud|comcast|verizon|me)\./;
```

**A rule that rejects free mail is the obvious rule and the wrong rule.** A gmail address for a two-person florist is normal and proves nothing. A corporate domain that shares nothing with the vendor's name or website shows an address copied from a directory page. Thus the check operates on the second case and never on the first case.

```
emailLooksForeign("inquiries@hideseekmedia.com", null, "Vinwood Caterers")                      true
emailLooksForeign("silverandsaltphoto@gmail.com", "https://www.silverandsaltphoto.com", …)   false
```

The permitted alternative is as important as the check. `record_vendor` accepts the literal string `contact form only`, which `isContactFormOnly` identifies. Thus a scout that cannot find a published address has an honest option, and it does not invent an address.

### A source that is not there

The liveness guard fetches the source URL. The guard is intentionally difficult to fail:

```ts
return res.status === 404 || res.status === 410;
```

Only a definitive 404 or 410 status causes a rejection. A 403 status shows bot blocking, and a timeout shows a network fault. A request that throws returns `false`. The result is that some dead pages pass. The file states the decision: a rejection on a 403 status or on a timeout removes real vendors, and that error costs more. The eval still reports reachability for the full set, so a measurement exists for what the guard passes.

### The guard that asked for a fact no tool could reach

One day later, the same method — remove the rule from the prompt, make it structural — got a second use: the couple's travel radius. A required field made the scout state a drive time for each vendor.

The system contains no geocoder, and a web search cannot answer *how long is the drive from A to B*. The scout did the only possible action: it searched, found no usable text, adjusted the query, and searched again.

```text
Searches spent on one drive time: 7 | Search budget: 25 of 25 | Vendors recorded: 1
```

That is the full search budget of one scout, and three scouts recorded too few vendors in that run. The budget is not the important number here. The question is the important part.

**Why does the tool require the town but not the drive time?** The town is printed on a page that the scout already opened. The drive time is on no page. That is the full test, and the recipe title states this rule. [`record_vendor.ts`](../../agent/subagents/scout/tools/record_vendor.ts) now encodes both sides of the test:

```ts
location: z
  .string()
  .min(2)
  .max(80)
  .describe("The vendor's actual town and state, e.g. 'Rowley, MA'. Required."),
distance_note: z
  .string()
  .max(120)
  .optional()
  .describe(
    "Optional, from your own knowledge of the area, e.g. '~35 min from Methuen'. " +
      "NEVER search for a drive time to fill this in — leave it blank instead.",
  ),
```

The instructions contain the related sentence, with the reason. Thus the model gets the reason, not only the ban: *"Never search for drive times or distances. Search cannot answer "how long is the drive from A to B", and trying burns the budget you need for finding vendors — one scout spent seven straight searches on a single drive time and came back with one vendor."* The radius stays a hard limit. The scout places the town from its own knowledge, or it skips the vendor.

With the drive note optional and the rule in prose, the decision record for `npm run eval:scout` reads:

```text
scout quality: 52/53 (98%) | radius judge: 100% across all five categories
```

The volume is the obvious number and the less important number. The second line says that the radius rule held after the change, on the day of the measurement.

### The prompt held for a day

A settled run on the next day gave a different result:

```text
scout quality: 46/53 (87%) | radius judge: 10/18 in region
recorded for a stated hour: Jackson NH ~98 straight-line mi | Tamworth NH ~79 | Keene NH ~57
```

The model was honest about each town, and thus the judge caught it. But the model cannot do the
arithmetic between towns. A rule that lives only in prose loses its effect with time. Thus the
question of this recipe needs a better answer. *Why does the tool require the town but not the
drive time?* The town is on a page, and the drive time is on no page. But the **distance** between
two towns is a third item. The model cannot produce it, and the tool can check it. Two coordinates
and a formula are sufficient.

Thus the rule returned at the write boundary as [`outsideRadius`](../../agent/lib/vendor-guards.ts).
The scout echoes the couple's town and radius from its brief. Nominatim geocodes both towns, with
one cached lookup for each town. The tool refuses a vendor beyond ~0.75 straight-line miles per
stated drive minute, with the status `rejected_outside_radius`. The check does no search and asks
no model. Each failure to judge causes a pass, which is also the rule of the liveness check.

```text
first guarded run:  rejected_outside_radius x5 | 12 of 12 recorded within 38 straight-line mi
next settled run:   scout quality: 49/54 (91%) | 13 of 14 recorded within 40 mi
```

The tool still recorded one caterer at 55 miles, and this is intentional. The brief echoes are
optional, because a schema that a model cannot satisfy stops a full child session. A scout that
omits the echoes gets the old behavior. **A guard with an intentional gap is honest about the
gap.** The radius judge stays as the second instrument. The judge reasons in drive time, the same
way as the couple. Where the two instruments disagree, the trace shows which one did the
arithmetic.

### Where this transfers

The point is not weddings. The pattern is this: an agent produces findings, and a human acts on the findings with permanent effects. Code can check the correctness of a finding, but code cannot produce the finding. Each such field of work gets the same two rules.

A procurement assistant reads a supplier quote from an aggregator, not from the supplier. A legal research agent cites a case reference that points to nothing. A recruiting agent attaches a contact address from a data broker to a candidate's name. A literature-review agent records a DOI that returns a 404 status. In each example, the tool that writes the record can check the host, the domain match, and the liveness. The tool needs no knowledge of the field of work. And in each example, the temptation on the next day is the same: demand a field that the tools cannot reach. Examples are a delivery lead time with no logistics API, a contract tier with no CRM tool, and a compound's toxicity with no assay.

**Guard the facts that the tool can check from pages the agent already opened. All other demands are requests, not controls.**

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| A specialist burns its whole search budget and records one vendor | A required field no available tool can produce | Make the field optional, forbid searching for it explicitly, and state the reason in the instructions |
| A legitimate vendor is silently absent from the plan | Substring matching on the URL classifying `luxewedding.com` as a directory | `directoryHost` matches on host labels; the vendor-own-domain rows in the suite are the regression |
| `rejected_dead_source` on a page that opens fine in a browser | The site answers a non-browser client with 403 | Only 404 and 410 reject; 403, timeout and thrown requests pass |
| `rejected_foreign_email` on a real vendor | A business emailing from a domain unrelated to its trading name | Free mail always passes; otherwise the scout records `contact form only` rather than guessing |
| Vendors researched, nothing saved | The research store is unavailable on this deployment | `not_configured` / `record_failed` are not refusals — the scout is told to keep the vendor in its final report |
| The same vendor appears twice | Two specialists overlapping on one business | Recording the same name twice updates that entry instead of duplicating it |

## Test it

```bash
npm run test:guards
```

The suite contains rows from a real production run. The rows include the findings that the scout eval caught, and the legitimate findings from the same run that must continue to pass. The rows also include vendor-owned domains that only look like directories, and a page on a real florist's own site that does not exist. The suite runs with no model and no API key. Thus you can verify a guard change without a research run.

## Going further

- **Give a guard an appeal path before you make the guard strict.** A scout cannot object to a rejection. The scout can only try again or stop. The liveness check fails toward a pass. Each status that rejects — directory source, missing source, missing location, dead source, foreign email — returns a note that names the next action.
- **Examine the cost of your rejections.** The liveness check spends one request for each recorded vendor. It runs before the email check, which has no cost. Thus a vendor with a foreign address causes one fetch that no check needed. A change to the order is small. First, learn which of your guards have a low cost.
- **Examine your prompt for facts that your tools cannot reach.** Read the instructions as a list of demands. For each demand, find the tool call that answers it. A demand with no answer makes the scout search without end and use all of its budget.
- **Check the guard against the eval, not against itself.** The unit suite proves the arithmetic. Only the separately pinned judge caught the day when the prose rule lost its effect. Only the eval shows what the guard's intentional gap passes.
- **Next: [Governance — Budget the Retrieval](../05-budget-the-retrieval/README.md)**. That recipe covers the cap that this recipe's counter-lesson used fully, and what a scout does when the budget is empty.

## License


This recipe is part of the [Venus](../../README.md) repository. The repository has no LICENSE file, and thus it grants no reuse rights by default.
