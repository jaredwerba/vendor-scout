# Verification — Assert Against the Deployed Artifact

> A local gate cannot see a production-only failure.

This is recipe **10 of 10** in the Venus Blueprint Recipes arc:

> Foundation → Delegation → Durability → Guards → Governance → Cost → Latency → Observability → Evaluation → **Verification**

On one day, this repository reported itself as verified, and it pushed a commit that failed
every production build. The check below gave that report. A stand-in command that exits
non-zero reproduces the check:

```text
$ node -e 'console.error("Build failed: 1 error"); process.exit(1)' 2>&1 | grep -iE "error|warn" && echo "no blocking output — shipping it"; echo "pipeline status: $?"
Build failed: 1 error
no blocking output — shipping it
pipeline status: 0
```

The command exits with the code 1. The pipeline exits with the code 0, because the shell takes
the exit code of a pipeline from its last stage. Here the last stage is `grep`. The transcript is
not the important part. Three separate faults were invisible to typecheck, to `next build`, and to
the evals. `eve build` reported the first fault, but the pipeline hid the report. Each fault
needed a different type of examination.

## What you'll build

| File | What it verifies |
| --- | --- |
| [`package.json`](../../package.json) | `npm run verify` — seven gates chained with `&&`, no pipes anywhere |
| [`scripts/test-outcomes.mjs`](../../scripts/test-outcomes.mjs) | Every status literal a tool can return is classified by the taxonomy |
| [`scripts/test-trace-fold.mjs`](../../scripts/test-trace-fold.mjs) | The fold, driven with the event shapes eve actually delivers |
| [`scripts/smoke-chat.mjs`](../../scripts/smoke-chat.mjs) | One real turn against a deployed host, over the public eve channel |
| [`scripts/shot.mjs`](../../scripts/shot.mjs) | The deployed pages, rendered at three viewports so they can be looked at |

## Prerequisites

- Install Node 24 — [`package.json`](../../package.json) declares `engines.node: "24.x"` — and run `npm install` at the repository root.
- Get a deployed URL. The two remote scripts default to the production host, and each accepts a base URL as `argv[2]`.
- Install Playwright for [`shot.mjs`](../../scripts/shot.mjs) with `npm i -D playwright`. Playwright is intentionally not a dependency of the app.
- Configure the deployment (`NEBIUS_API_KEY`, the KV vars) for the smoke turn. The smoke turn reads no local environment variables.
- Complete Recipe 09 (Evaluation) first. The evals score what the agent decides, but they do not open the page that the agent decided on.

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

(The list above is short: it shows two of the twenty-two literals and one part case.) Each script
exits non-zero when a failure occurs, and it names the assertion that failed. The two scripts do
not use the network, and they do not find the three faults in this recipe.

## Walk-through

### The exit status belongs to grep

This is the real message that failed every production build. eve gave the message when
[`agent/tools/agent.ts`](../../agent/tools/agent.ts) called `disableTool()` on a built-in tool:

```text
agent/tools/agent.ts exports disableTool() but "agent" is not a framework tool.
Rename the file to one of: ask_question, bash, glob, grep, load_skill, read_file,
todo, web_fetch, web_search, write_file.
```

That sentence does not contain the word `error` or the word `warn`. The pipeline checked the build
with `npx eve build 2>&1 | grep -i error`. Thus grep printed nothing, and the check read the empty
output as a good build.

**When a pattern matcher is silent, the pattern did not match. Silence does not show that the
command succeeded.** These are two different claims, and only one claim is about the build. The
exit code was 1 the whole time, but the check read only the output. The opposite case is worse.
When a failed build prints the word `error`, grep exits with the code 0. The transcript at the top
of this recipe shows this case. A pipe also hides an exit code when the pipe contains no grep:

```text
$ node -e "process.exit(1)" | cat; echo "masked: $?"
masked: 0
```

**Do not pipe a build into another command.** `set -o pipefail` corrects the hidden exit code, and
it is a good setting. But it does not correct a check that reads stdout to decide if a command was
successful. Do not parse the output. Chain the commands. From [`package.json`](../../package.json):

```json
"verify": "npm run typecheck && npm run build && npm run build:eve && npm run test:guards && npm run test:outcomes && npm run test:fold && npm run cookbook:check"
```

The chain has seven gates with `&&` between each pair, and it has no pipes and no greps. Each
non-zero exit code stops the chain and fails the command. `cookbook:check` is in the chain for the
same reason as the tests. [`build-cookbook-readme.mjs --check`](../../scripts/build-cookbook-readme.mjs)
fails when the recipes table does not agree with the `recipe.json` files that generate it. Thus a
stale catalog becomes a broken build, not a problem for the reader.

### A section that existed only in development

The `/observe` console lists five configurations of the same agent. The console reads them from
[`generations.json`](../../evals/data/generations.json). The section rendered on the local
machine. On the deployed page, the section was absent, with no error, no empty state, and no gap
in the layout. Typecheck passed, and `next build` passed. Three acceptable decisions combine into
one silent decision:

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

`readFileSync` with `new URL(..., import.meta.url)` resolves to a path on your local disk. The
path does not exist inside a bundled serverless function. No static reference points to the JSON
file, so the bundler does not put the file into the output. The `try/catch` changes the missing
file into an empty array. The `generations.length > 0` render guard changes the empty array into
no section. The fix in [`app/observe/page.tsx`](../../app/observe/page.tsx) is one import:

```ts
import generationsData from "@/evals/data/generations.json";
```

**State the choice, then name the failure that the choice prevents.** The choice is to import the
data as a module, so that the bundler carries the data. The prevented failure is a file-system
read that is successful only on some machines. A local gate cannot see this difference, because
the local gate *is* the machine where the read is successful.

**A `catch` that supplies a default value is a decision to have no error.** Do not use this
pattern before a rendered section. The fallback and the real data look identical when the real
data is empty. A manual fetch of the deployed page, with an assertion on the page content, found
this fault. No other check can find it.

### A panel nobody had looked at

The third fault passed every gate, because no gate in the list renders a page. The observability
panel is the engineering half of the product. The panel copied its palette from a reference
architecture image: teal for the control plane, pale blue for the harness, periwinkle for the
state, navy for the model plane, and lime for the outcome. None of these colors exist in the app.
Now each plane reads a `--vs-*` variable, declared beside the app's own palette in
[`globals.css`](../../app/globals.css), with a dark-theme block for each variable.

The color was the easy half, and the geometry was not. During a fan-out, the panel shows one card
for each agent. A full stat card for each agent pushed the live event stream below the bottom of
the viewport, at the moment when there is content to watch. From
[`observability-rail.tsx`](../../app/_components/observability-rail.tsx):

```tsx
// Collapsed by default. A fan-out is five or six agents, and a full stat
// card each pushed the event stream off the screen entirely — the detail
// belongs to whichever lane you are actually looking at.
```

**Vertical space is a limited quantity. Use it where the layout is most narrow.** The lane list
scrolls in its own tile. The height limit of the list changes with the column count, and the
limit is not constant:

```css
.vlanes { max-height: 13.5rem; overflow-y: auto; /* … */ }
/* Between lg and 2xl the panel is one column, so the vertical budget is the
   scarce thing: more padding must be paid for by a shorter lane list, or the
   event stream drops below the fold — which is exactly when it matters. */
@media (min-width: 1280px) { .vlanes { max-height: 6rem; /* … */ } }
@media (min-width: 1536px) { .vlanes { max-height: 17rem; } }
```

The smallest height limit is at the widest breakpoint below `2xl`. This looks incorrect until you
see that the panel has one column there and two columns above it.
[`shot.mjs`](../../scripts/shot.mjs) makes these properties checkable. The script operates the
Chrome that is installed on the machine, against a base URL. The default base URL is the
production host:

```js
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1180, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];
```

The script uses three viewports, because the panel has two grid layouts and a sheet, and one
width can show only one of them. The script imports Playwright inside a `try` block that exits
with the install instruction. Playwright is not in the dependencies. A screenshot tool that each
deploy must install is soon removed from the deploy.

### One real turn, against the thing that is actually serving

[`smoke-chat.mjs`](../../scripts/smoke-chat.mjs) has twenty-five lines. The script asserts the one
property that no local run can assert: the deployed host, the public eve channel, and the Token
Factory model plane operate together now:

```js
const model = result.events.find((e) => e.type === "session.started")?.data?.runtime?.modelId;
```

The script reads the model id from the `session.started` event, not from the local configuration.
Thus the deployment, not the file that you edited, answers the question *which model served this
turn*. The script sends a first message that does not start outreach. Thus the check uses one
session, and it reaches no stranger.

### What this still does not verify

The fix for the absent section is in the repository. **The check that found the fault is not in
the repository.** No script in [`scripts/`](../../scripts/) fetches a deployed page and asserts
its content. A person did that check by hand, one time, and `npm run verify` stays a fully local
gate. The title of this recipe is *assert against the deployed artifact*, but the repository does
not automate the assertion. The recipe must say this, and it does.

[`shot.mjs`](../../scripts/shot.mjs) renders PNG files, and it asserts nothing about them. The
script changes the work from analysis to examination, and this change is the full gain. A person
must still examine the images. The record also moves away from the artifact in the way that this
recipe describes. [`decisions.json`](../../evals/data/decisions.json) records the layout outcome
as five tiles visible at 1440x900, but
[`observability-rail.tsx`](../../app/_components/observability-rail.tsx) renders four `vtile`
sections. A person compared only one of these two sources with the code.

### Taking it somewhere that is not a wedding

The point is not weddings. This pattern applies to each domain where the artifact that runs is not
the artifact that you compiled. One example is a claims pipeline that reads PDF templates from the
disk in development but from a bundle in production. A second is a legal-research tool whose
citation panel renders below the fold on the laptops that associates use. A third is an internal
support console that configures its model routing in one place and serves it from another place. A
fourth is a nightly ETL job whose wrapper greps its own logs and reports success.

Chain the gates with `&&`. Do not use a pipe. Import your data; do not read it from the disk.
Fetch the deployed URL, and assert a string that must be on the page. Then render the page and
examine it, because a green suite is only a statement about your machine.

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

The suite makes sure that the two builds complete and that each tool status is classified. The
suite also makes sure that the fold interprets eve's real event shapes correctly, and that the
cookbook catalog agrees with its sources. The suite makes sure of nothing about the deployment,
because each command in the suite runs on the local machine. That gap is the subject of this
recipe. Two commands close the gap: [`smoke-chat.mjs`](../../scripts/smoke-chat.mjs) and
[`shot.mjs`](../../scripts/shot.mjs). Each command accepts a base URL, and a person runs each
command by hand.

## Going further

- **Put an assertion on the deployed page into the chain.** One `fetch` of `/observe`, with a
  check for a string that the generations section must contain, finds that fault immediately.
  This is the one check that this repository does not have.
- **Compare the screenshots; do not only make them.** [`shot.mjs`](../../scripts/shot.mjs) writes
  a constant filename for each page and viewport. Thus a comparison of two runs changes a manual
  examination into a check that can fail on its own.
- **Read the record that this recipe comes from.** [`decisions.json`](../../evals/data/decisions.json)
  and the generated [engineering log](../../docs/engineering-log.md) contain the three faults with
  dates and commits. They include the tile count that does not agree with the component.
- **Go back to the arc.** [The ten recipes](../README.md) start at Foundation and end here. Each
  earlier recipe is a claim about a system, and the value of the claim is equal to the value of
  the check behind it.

## License


This recipe is part of the [Venus](../../README.md) repository. The repository has no LICENSE
file, so it grants no reuse rights by default.
