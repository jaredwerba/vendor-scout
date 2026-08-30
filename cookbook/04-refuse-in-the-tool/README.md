# Guards — Refuse in the Tool, Not in the Prompt

> Move a broken rule into the tool — but only where the tool can actually check it.

Recipe **04 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → **Guards** → Governance → Cost → Latency → Observability → Evaluation → Verification

A caterer was recorded with the inquiry address `inquiries@hideseekmedia.com`, taken from a WeddingWire page for a different business. Venus sends vendor outreach for real, with the couple as reply-to, so that address was one plan away from putting a wedding inquiry in a media company's inbox.

Both halves of that were already forbidden in writing. The scout's instructions ban directory sources and require a published address on the vendor's own contact page. The model read them and did it anyway.

The fix is to move the rule from the prompt into `record_vendor`, the tool that writes a finding into the research store. The instinct is right and it generalizes — and applied one day later to a different rule, it drained a specialist's entire search budget to produce one vendor:

```text
Searches spent on one drive time: 7 | Search budget: 25 of 25 | Vendors recorded: 1
```

That specialist was not confused. It was obedient. It had been told to state a drive time for every vendor, and it had no tool that could produce one.

## What you'll build

```
agent/
  lib/
    vendor-guards.ts             # four checks: directory, foreign email, contact form, liveness
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
- Network access: the liveness guard issues one real `GET` per recorded vendor, and the suite fetches live URLs.
- No model key is needed for the guard suite. The guards are pure functions plus one `fetch`, so they run without an LLM.
- `NEBIUS_API_KEY` in `.env.local` only if you also want `npm run eval:scout`, which drives real planning turns.

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

[`agent/subagents/scout/instructions.md`](../../agent/subagents/scout/instructions.md) is not vague about this:

```md
**The email must belong to that business.** Take it from their own contact page. An address
whose domain has nothing to do with the vendor (a marketing agency, a venue you found them
through, a directory) is not their address — record `contact form only` instead. A real
stranger receives whatever you record here.
```

**Repeating a rule the model has already broken is not a control.** The instruction is still there, and it still helps — it shapes what the scout looks for while it is searching. What it cannot do is decide whether a particular finding obeys it. Only something downstream of the model can do that, and there is exactly one place downstream: the tool that writes.

### The guard runs at the write, not at the read

[`agent/subagents/scout/tools/record_vendor.ts`](../../agent/subagents/scout/tools/record_vendor.ts) checks before it stores. The directory case:

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

**A rejection is an instruction, not an error.** The tool returns a machine-readable `status` and a `note` addressed to the model, and the note says what to do next: open their real site, take the email from there, record it again. A refusal that only says *no* costs the scout a step and teaches it nothing.

**Ordering is partly load-bearing and partly not.** The two cheapest checks — is this URL a directory, is it a URL at all — run before `sourceIsMissing`, which costs a network round trip, so a WeddingWire listing never pays for a `GET`. The email check is equally free but runs last, after the fetch, so a vendor with a foreign address still pays for one request before being turned away. Nothing depends on that today; it is worth knowing before you copy the order.

Two statuses in the same tool are deliberately *not* refusals. When the research store is unavailable the tool returns `not_configured`, and a failed write returns `record_failed` — both telling the scout to carry the vendor in its final report instead. A guard rejects a bad finding. An outage must not.

### Match on host labels, not on substrings

The first implementation of the directory check asked whether the URL string contained any of twenty known listing hosts. From the docblock in [`agent/lib/vendor-guards.ts`](../../agent/lib/vendor-guards.ts):

```
 * Matched on HOST LABELS, not as a substring of the URL. Plain `includes`
 * read "wedding.com" inside `luxewedding.com` and "brides.com" inside
 * `sarahbrides.com`, so a real vendor's own domain was classified as a
 * directory and silently discarded — and a scout has no way to appeal a
 * guard. A share link in a query string (`?share=facebook.com/...`) did the
 * same to a legitimate gallery page.
```

`url.includes("wedding.com")` is the anti-pattern, and its consequence is the expensive direction of failure: a real vendor vanishes from the plan with no message and no way for the model to argue. The replacement parses the host and matches three declared pattern shapes — a single label anywhere in the host, a domain suffix on a label boundary, and a host-plus-path for `google.com/maps`.

```
directoryHost("https://www.weddingwire.com/biz/barn-at-bradstreet-farm-rowley/db2f55d")  "weddingwire."
directoryHost("https://luxewedding.com/portfolio")                                      null
directoryHost("https://www.barnatgibbethill.com/gallery?share=facebook.com/x")          null
```

The four `PASS` rows in the suite named `Luxe Wedding Co`, `Sarah Brides Bridal`, `Skylark Farm` and `Notyelp Studio` exist only because of that bug. **A guard with no appeal path has to be more careful than the model it constrains.**

### An address that plausibly belongs to the business

`emailLooksForeign` compares the mail domain against the vendor's website and the words of its name, and returns `false` — passes — for free mail:

```ts
const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|aol|icloud|comcast|verizon|me)\./;
```

**Rejecting free mail is the obvious rule and the wrong one.** A gmail address on a two-person florist is normal and proves nothing either way; a corporate domain sharing nothing with the vendor's name or website is the signature of an address lifted off a directory page. So the check fires on the second and never on the first.

```
emailLooksForeign("inquiries@hideseekmedia.com", null, "Vinwood Caterers")                      true
emailLooksForeign("silverandsaltphoto@gmail.com", "https://www.silverandsaltphoto.com", …)   false
```

The escape hatch matters as much as the check. `record_vendor` accepts the literal string `contact form only`, recognised by `isContactFormOnly`, so a scout that cannot find a published address has somewhere honest to go and never has to invent one.

### A source that is not there

The liveness guard fetches the source URL. It is deliberately hard to fail:

```ts
return res.status === 404 || res.status === 410;
```

Only a definitive 404 or 410 rejects. A 403 is bot blocking, a timeout is the network, and a thrown request returns `false` — the mechanism. The consequence is that some dead pages get through. The verdict is in the file: rejecting on 403 or timeout would throw away real vendors, *which is the more expensive mistake*. The eval still reports reachability across the whole set, so what the guard lets pass is still measured somewhere.

### The guard that asked for a fact no tool could reach

The same instinct — take the rule out of the prompt and make it structural — was applied the next day to the couple's travel radius. Every vendor was required to state its drive time from the couple.

There is no geocoder in this system, and a web search cannot answer *how long is the drive from A to B*. The scout did the only thing left: it searched, read nothing usable, refined the query, and searched again.

```text
Searches spent on one drive time: 7 | Search budget: 25 of 25 | Vendors recorded: 1
```

That is one specialist's entire retrieval budget, and three specialists under-recorded in that run. The budget is not the interesting number here. The question is.

**Why is the town still required and the drive time not?** Because the town is printed on a page the scout has already opened, and the drive is on no page at all. That is the whole test, and it is the line the recipe title is about. [`record_vendor.ts`](../../agent/subagents/scout/tools/record_vendor.ts) now encodes both sides of it:

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

The instructions carry the matching sentence, including the reason, so the model is not merely forbidden but told why: *"Never search for drive times or distances. Search cannot answer 'how long is the drive from A to B', and trying burns the budget you need for finding vendors."* The radius itself stays a hard limit — the scout places the town from what it already knows, or skips the vendor.

Under the required drive time, and under the optional drive note, `npm run eval:scout` reports:

```text
scout quality: 33/37
scout quality: 52/53 (98%) | radius judge: 100% across all five categories
```

The volume is the obvious number and the less interesting one. What the second line says is that the radius discipline survived the relaxation — the guard was removed and the behaviour it was protecting stayed.

### Where this transfers

The point is not weddings. The pattern is: an agent produces findings that a human will act on irreversibly, and the correctness of a finding is checkable by code even though the finding itself is not producible by code. Any such domain gets the same two rules.

A procurement assistant reading a supplier quote off an aggregator instead of the supplier. A legal research agent citing a case reference that resolves to nothing. A recruiting sourcer attaching a contact address scraped from a data broker to a candidate's name. A literature-review agent recording a DOI that 404s. In each one, the tool that writes the record can check host, domain plausibility and liveness without knowing anything about the domain — and in each one, the temptation the day after is to also demand a field the tools cannot reach: a delivery lead time with no logistics API, a customer's contract tier with no CRM tool, a compound's toxicity with no assay.

**Guard what is checkable from what the agent already has open. Everything else is a request, not a control.**

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

The suite is built from rows of a real production run — the findings the scout eval caught, the legitimate findings from the same run that must keep passing, the vendor-owned domains that merely resemble directories, and a page on a real florist's own site that does not exist. It runs with no model and no API key, so a guard change is verified in seconds rather than in a research run.

## Going further

- **Give a guard an appeal path before you make it strict.** A scout cannot argue with a rejection; it can only try again or give up. The liveness check is written to fail toward *let it through*; the two that do reject — directory and foreign email — each return a note naming the alternative.
- **Look at what your rejections cost.** The liveness check spends one request per recorded vendor and runs before the email check, which is free — so a vendor with a foreign address pays for a fetch nothing needed. Reordering is a small change; knowing which of your guards are cheap is the part worth doing first.
- **Audit your prompt for facts your tools cannot reach.** Read the instructions as a list of demands and ask, for each one, which tool call would answer it. The ones with no answer are the death spirals.
- **Check the guard against the eval, not against itself.** The radius held at 100% across all five categories only because a separately-pinned judge measures it; the guard's own unit test cannot tell you that.
- **Next: [Governance — Budget the Retrieval](../05-budget-the-retrieval/README.md)**, which is the cap this recipe's counter-lesson exhausted, and what a specialist does when it runs out.

## License


Part of the [Venus](../../README.md) repository, which carries no LICENSE file — no reuse rights are granted by default.
