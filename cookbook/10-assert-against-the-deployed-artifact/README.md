# Verification — Assert Against the Deployed Artifact

> A local gate cannot see a production-only failure.

Recipe **10 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → Governance → Cost → Latency → Observability → Evaluation → **Verification**

This repository reported itself verified on the day it pushed a commit that failed every production
build. Here is the check that said so, reproduced with a stand-in command that exits non-zero:

```text
$ node -e 'console.error("Build failed: 1 error"); process.exit(1)' 2>&1 | grep -iE "error|warn" && echo "no blocking output — shipping it"
Build failed: 1 error
no blocking output — shipping it
pipeline status: 0
```

The command exited 1. The pipeline exited 0, because a pipeline's status belongs to its last stage
and the last stage was `grep`. The transcript is not the interesting part — three separate faults
here were invisible to typecheck, to `next build`, to `eve build` and to the evals, and each needed
a different kind of looking to find.

## What you'll build

| File | What it verifies |
| --- | --- |
| [`package.json`](../../package.json) | `npm run verify` — seven gates chained with `&&`, no pipes anywhere |
| [`scripts/test-outcomes.mjs`](../../scripts/test-outcomes.mjs) | Every status literal a tool can return is classified by the taxonomy |
| [`scripts/test-trace-fold.mjs`](../../scripts/test-trace-fold.mjs) | The fold, driven with the event shapes eve actually delivers |
| [`scripts/smoke-chat.mjs`](../../scripts/smoke-chat.mjs) | One real turn against a deployed host, over the public eve channel |
| [`scripts/shot.mjs`](../../scripts/shot.mjs) | The deployed pages, rendered at three viewports so they can be looked at |

## Prerequisites

- Node 24 — [`package.json`](../../package.json) declares `engines.node: "24.x"` — and `npm install` at the repository root.
- A deployed URL to point at. Both remote scripts default to the production host and take a base URL as `argv[2]`.
- Playwright for [`shot.mjs`](../../scripts/shot.mjs): `npm i -D playwright`. Deliberately not a dependency of the app.
- The deployment configured (`NEBIUS_API_KEY`, the KV vars) for the smoke turn — it reads no local env of its own.
- Recipe 09 (Evaluation) first. Evals score what the agent decides; nothing in them opens the page it decided on.

## Run it

```bash
npm install
npm run test:outcomes    # every tool status is classified, or the command fails
npm run test:fold        # the trace fold, on eve's real event shapes
```

```text
22 status literals across 26 sources
  ✓ cap_reached                -> refused
  ✓ not_found                  -> failed
  ✓ part {"state":"output-denied"}                         -> refused
1 runtime-assembled status site(s), all vetted
outcome taxonomy: complete and correct
```

(The status list is elided to three of twenty-two.) Both scripts exit non-zero on any failure and
name the assertion that moved. Neither touches a network, and neither would have caught two of the
three faults in this recipe.

## Walk-through

### The exit status belongs to grep

The real message that failed every production build, raised by eve when
[`agent/tools/agent.ts`](../../agent/tools/agent.ts) called `disableTool()` on a built-in:

```text
agent/tools/agent.ts exports disableTool() but "agent" is not a framework tool.
Rename the file to one of: ask_question, bash, glob, grep, load_skill, read_file,
todo, web_fetch, web_search, write_file.
```

That sentence contains neither `error` nor `warn`. The build was being checked with
`npx eve build 2>&1 | grep -i error`, so grep printed nothing, and nothing was read as clean.

**Silence from a pattern matcher means the pattern did not match, not that the command succeeded.**
Those are different claims and only one is about the build. The status said 1 the whole time; nobody
read it, because the output was the thing being read. The inversion is worse than the omission — a
build that fails while printing the word `error` makes grep exit 0, which is the transcript at the
top of this recipe. And a pipe launders a status even with no grep in it:

```text
$ node -e "process.exit(1)" | cat; echo "masked: $?"
masked: 0
```

**The anti-pattern is piping a build into anything.** `set -o pipefail` fixes the masking and is
worth having, but it does not fix reading stdout to decide whether a command worked. Stop parsing;
start chaining. From [`package.json`](../../package.json):

```json
"verify": "npm run typecheck && npm run build && npm run build:eve && npm run test:guards && npm run test:outcomes && npm run test:fold && npm run cookbook:check"
```

Seven gates, `&&` between every pair, no pipes and no greps, so any non-zero status stops the chain
and fails the command. `cookbook:check` is in there for the same reason the tests are:
[`build-cookbook-readme.mjs --check`](../../scripts/build-cookbook-readme.mjs) fails when the
recipes table has drifted from the `recipe.json` files that generate it, which makes a stale catalog
a broken build rather than a reader's problem.

### A section that existed only in development

The `/observe` console lists five configurations of the same agent, read from
[`generations.json`](../../evals/data/generations.json). It rendered locally. On the deployed page
the section was simply absent — no error, no empty state, no gap in the layout. Typecheck passed;
`next build` passed. Three defensible decisions compose into one silent one:

```ts
// app/observe/page.tsx, in the version that rendered on a laptop
try {
  generations = JSON.parse(
    readFileSync(new URL("../../evals/data/generations.json", import.meta.url), "utf8"),
  );
} catch {
  generations = [];
}
```

`readFileSync` against `new URL(..., import.meta.url)` resolves to a path that exists on your disk
and not inside a bundled serverless function — nothing static links to the JSON, so it is never
traced into the output. The `try/catch` turns the missing file into an empty array, and the
`generations.length > 0` render guard turns that into no section at all. The fix in
[`app/observe/page.tsx`](../../app/observe/page.tsx) is one import:

```ts
import generationsData from "@/evals/data/generations.json";
```

**State the choice, then name the failure it avoids.** The choice is to import the data as a module
so the bundler carries it. The failure avoided is a file-system read whose success depends on which
machine is running it — the one difference a local gate is structurally unable to observe, because
the local gate *is* the machine where it works.

**A `catch` that substitutes a default is a decision to have no error.** It is never right in front
of a rendered section, because the fallback and the real thing are pixel-identical when the real
thing is empty. This one was caught by fetching the deployed page and asserting its content was in
it. Nothing else could have.

### A panel nobody had looked at

The third fault passed every gate because no gate in the list renders anything. The observability
panel — the engineering half of the product — had been recreated from a reference architecture
image, palette included: teal control plane, pale blue harness, periwinkle state, navy model plane,
lime outcome, none of which exist anywhere in the app. Every plane now reads a `--vs-*` variable
declared beside the app's own palette in [`globals.css`](../../app/globals.css), with a dark-theme
block for each. Colour was the cheap half. Geometry was not. During a fan-out the panel shows one
card per agent, and a full stat card each pushed the live event stream entirely off the bottom of
the viewport — at exactly the moment there is something to watch. From
[`observability-rail.tsx`](../../app/_components/observability-rail.tsx):

```tsx
// Collapsed by default. A fan-out is five or six agents, and a full stat
// card each pushed the event stream off the screen entirely — the detail
// belongs to whichever lane you are actually looking at.
```

**Vertical space is a budget, so spend it where the layout is tightest.** The lane list scrolls in
its own tile, and its cap moves with the column count rather than staying constant:

```css
.vlanes { max-height: 13.5rem; overflow-y: auto; }
/* Between lg and 2xl the panel is one column, so the vertical budget is the
   scarce thing: more padding must be paid for by a shorter lane list, or the
   event stream drops below the fold — which is exactly when it matters. */
@media (min-width: 1280px) { .vlanes { max-height: 6rem; } }
@media (min-width: 1536px) { .vlanes { max-height: 17rem; } }
```

The tightest cap sits at the widest breakpoint below `2xl`, which reads backwards until you notice
the panel is one column there and two above it. [`shot.mjs`](../../scripts/shot.mjs) is what makes
any of this checkable — it drives the Chrome already on the machine, against a base URL defaulting
to production:

```js
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1180, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];
```

Three viewports because the panel has two grid layouts and a sheet, and one width can only exercise
one of them. Playwright is imported inside a `try` that exits with the install line, and kept out of
the dependencies: a screenshot tool every deploy has to install gets removed from the deploy.

### One real turn, against the thing that is actually serving

[`smoke-chat.mjs`](../../scripts/smoke-chat.mjs) is twenty-five lines and asserts the one property
no local run can — that the deployed host, the public eve channel and the Token Factory model plane
work together right now:

```js
const model = result.events.find((e) => e.type === "session.started")?.data?.runtime?.modelId;
```

It reads the model id back off `session.started` rather than off local config, so the answer to
*which model served this* comes from the deployment and not from the file you just edited. The
opener is chosen never to trigger outreach, so the check costs a session and reaches no stranger.

### What this still does not verify

The fix for the vanishing section is in the tree. **The check that found it is not.** No script in
[`scripts/`](../../scripts/) fetches a deployed page and asserts its content — that was done by
hand, once, and `npm run verify` remains an entirely local gate. A recipe titled *assert against the
deployed artifact* whose repository does not automate the assertion should say so in the recipe.

[`shot.mjs`](../../scripts/shot.mjs) renders PNGs and asserts nothing about them. It moves the work
from reasoning to looking, which is the whole gain, and still needs a person to look. And the record
drifts from the artifact in exactly the way this recipe is about:
[`decisions.json`](../../evals/data/decisions.json) records the layout outcome as five tiles visible
at 1440x900, while [`observability-rail.tsx`](../../app/_components/observability-rail.tsx) renders
four `vtile` sections. One of those two was re-read against the code.

### Taking it somewhere that is not a wedding

The point is not weddings specifically. This pattern transfers to any domain where the artifact that
runs is not the artifact you compiled: a claims pipeline whose PDF templates are read off disk in
development and bundled in production, a legal-research tool whose citation panel renders below the
fold on the laptops associates actually use, an internal support console whose model routing is
configured in one place and served from another, a nightly ETL whose success is reported by a
wrapper that greps its own logs. Chain gates with `&&`, never with a pipe. Import your data instead
of reading it. Fetch the deployed URL and assert a string that is supposed to be on it. Then render
the page and look at it, because a green suite is a statement about your machine.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| A broken build reports as verified | The check greps stdout; the pipeline's status belongs to grep | Chain gates with `&&` and read exit codes ([`package.json`](../../package.json)) |
| A failing command inside a pipeline reports 0 | The shell returns the last stage's status | `set -o pipefail`, and stop piping builds at all |
| A section renders locally and is absent when deployed | `readFileSync` on an `import.meta.url` path; the file is never traced into the bundle | Import the JSON as a module ([`app/observe/page.tsx`](../../app/observe/page.tsx)) |
| A missing file renders as an empty section rather than an error | `try/catch` substituting a default, behind a `length > 0` render guard | Drop the fallback, or make the empty state visibly unlike the populated one |
| The panel passes every gate and cannot be read | Nothing in typecheck, build or evals renders anything | [`shot.mjs`](../../scripts/shot.mjs) at three viewports, against the deployed URL |
| Content drops below the fold during a fan-out | Per-agent cards grow without a cap | One row per lane, capped per breakpoint ([`globals.css`](../../app/globals.css)) |
| A new tool status is counted as a success | The taxonomy and the tool literals are linked by nothing | [`test-outcomes.mjs`](../../scripts/test-outcomes.mjs) reads the literals back out of the sources |

## Test it

```bash
npm run verify   # typecheck · next build · eve build · test:guards · test:outcomes · test:fold · cookbook:check
```

The suite guarantees that both builds complete, that every tool status is classified, that the fold
interprets eve's real event shapes correctly, and that the cookbook catalog matches its sources. It
guarantees nothing about the deployment, because every command in it runs here. That gap is the
recipe: the two commands that address it — [`smoke-chat.mjs`](../../scripts/smoke-chat.mjs) and
[`shot.mjs`](../../scripts/shot.mjs) — take a base URL and are run by hand.

## Going further

- **Put an assertion on the deployed page into the chain.** A single `fetch` of `/observe` checked
  for a string the generations section must contain would have caught that fault the second it
  appeared. It is the one check this repository is still missing.
- **Diff the screenshots rather than only taking them.** [`shot.mjs`](../../scripts/shot.mjs) writes
  deterministic filenames per page and viewport, so comparing two runs turns "look at it" into a
  check that can fail on its own.
- **Read the record this was built from.** [`decisions.json`](../../evals/data/decisions.json) and
  the generated [engineering log](../../docs/engineering-log.md) carry all three faults with dates
  and commits, including the tile count that no longer matches the component.
- **Back to the arc.** [The ten recipes](../README.md) start at Foundation and end here, because
  every earlier one is a claim about a system — worth exactly what you checked it against.

## License


Part of the [Venus](../../README.md) repository, which carries no LICENSE file — no reuse rights are granted by default.
