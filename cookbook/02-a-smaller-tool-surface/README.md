# Delegation — Give the Specialist a Smaller Tool Surface

> Do not give a subagent a capability that it must not use.

Recipe **02 of 10** in the Venus Blueprint Recipes arc:

> Foundation → **Delegation** → Durability → Guards → Governance → Cost → Latency → Observability → Evaluation → Verification

Venus plans a wedding with parallel research: one scout for each category, and a maximum of five at one time. Each scout searches the open web for venues, caterers, photographers, florists, and music. The first version delegated the research with eve's built-in `agent` tool. Nothing looked wrong. The plans were good, the builds passed, and no run failed.

The built-in tool runs a copy of the *root* agent, with the same instructions and the same tools. The tools of the root agent include `send_outreach`, which sends a real email to a real stranger. Thus each child agent was also an outreach agent. Nobody decided that. The child agent received the capability through inheritance. One bad inference was sufficient for the child agent to use it.

We moved the research into a declared subagent, the scout, which does not have this tool. The decision record below comes from a production session traced after that change:

```text
scout calls: 10 | agent calls: 3 | session: 1
```

The guardrails section of [`agent/instructions.md`](../../agent/instructions.md) states that `scout` is the *only* delegation path for the root agent. The important number is not three. The sentence that forbids those three calls was in the context window for each of them.

## What you'll build

```
agent/
  agent.ts                          # the root: planner model, no token gates
  instructions.md                   # "`scout` is your ONLY way to delegate"
  tools/
    agent.ts                        # shadows eve's built-in delegate — refuses
    send_outreach.ts                # the real-world action, root only
    get_research.ts                 # reads what the specialists wrote down
    web_search.ts                   # one implementation, shared
  subagents/
    scout/
      agent.ts                      # declared specialist — inherits nothing
      instructions.md               # its own role, its own absolutes
      tools/
        web_search.ts               # re-export of the root's implementation
        record_vendor.ts            # the only way a finding leaves the child
        bash.ts                     # disableTool()
        glob.ts                     # disableTool()
        grep.ts                     # disableTool()
        read_file.ts                # disableTool()
        write_file.ts               # disableTool()
        todo.ts                     # disableTool()
        ask_question.ts             # disableTool() — a child's question renders in no UI
        web_fetch.ts                # disableTool() — retrieval outside the search budget
      hooks/
        observe.ts                  # re-export: a child nobody can watch is not observable
  lib/
    models.ts                       # planner and scout are separate roles
    search-budget.ts                # the specialist's cap is not the root's
    research.ts                     # where record_vendor lands
```

## Prerequisites

- Node 24.x — the `engines` pin in `package.json` — and a checkout of this repository. The commands below inspect the real agent, not a sample.
- `eve` ^0.24.4. `eve build` writes the manifest the checks read.
- `jq`, for reading `.eve/agent-summary.json`.
- `NEBIUS_API_KEY` in `.env.local` if you want to *run* the agent and not only inspect its surface.
- Read [`agent/lib/models.ts`](../../agent/lib/models.ts) first: `planner` and `scout` are separate roles. This recipe assumes that you know why.

## Run it

```bash
npm run build:eve

# every tool the root agent can call
jq -r '.tools[].name' .eve/agent-summary.json

# the declared specialists
jq -r '.subagents[].name' .eve/agent-summary.json

# the specialist's surface: defined, minus disabled
grep -L disableTool agent/subagents/scout/tools/*.ts
```

```text
$ jq -r '.tools[].name' .eve/agent-summary.json
agent
cancel_followups
check_outreach_status
check_timeline
complete_milestone
generate_wedding_timeline
get_research
log_vendor_reply
mark_vendor_booked
save_wedding_plan
send_outreach
web_search

$ jq -r '.subagents[].name' .eve/agent-summary.json
scout

$ grep -L disableTool agent/subagents/scout/tools/*.ts
agent/subagents/scout/tools/record_vendor.ts
agent/subagents/scout/tools/web_search.ts
```

Those two listings are the full recipe. `send_outreach` appears in one listing and not in the other. No sentence anywhere keeps it that way.

## Walk-through

### The built-in delegate is a clone, not a specialist

eve supplies an `agent` tool. A call to this tool starts a child session that runs a copy of the root agent, with the same instructions and the same tools. That is a useful default for "do this same job on a different input". It is wrong for "do a *narrower* job".

**Inheritance is the failure, not the child.** The child agent never did a wrong action. It searched, it summarised, and it returned. But its tool set included the one tool that reaches outside the process. Only the model's decision not to call that tool kept a wedding inquiry out of a stranger's inbox.

### A declared subagent inherits nothing

A directory under `agent/subagents/` with its own `agent.ts` is a different agent, not a copy. The code below comes from [`agent/subagents/scout/agent.ts`](../../agent/subagents/scout/agent.ts):

```ts
export default defineAgent({
  description:
    "Researches ONE wedding-vendor category (venue, photography, catering, florals, music, " +
    "styling) against a couple's brief and budget, and returns 3-4 real, currently-operating " +
    "vendors with published contact details, price signals and source links. Reads the web " +
    "only — it never contacts a vendor.",
  // …
  model: modelFor("scout"),
  modelContextWindowTokens: contextWindowFor("scout"),
```

The `description` states the boundary — *it never contacts a vendor* — in the same place that advertises the capability. **State the choice, then name the failure that the choice prevents.** The scout has no `send_outreach` import and no `send_outreach` file under its `tools/`. Thus the schema that the scout sees has no `send_outreach`.

### Two tools, and one of them is a re-export

[`agent/subagents/scout/tools/web_search.ts`](../../agent/subagents/scout/tools/web_search.ts) is four lines:

```ts
// The same Tavily-backed search the root uses (agent/tools/web_search.ts).
// Declared subagents inherit nothing, so the capability is re-exported here
// rather than duplicated — one implementation, one search budget helper.
export { default } from "../../../tools/web_search";
```

Zero inheritance has a second effect: you must explicitly grant each capability that you *do* want. Re-export the tool, and do not copy it. A second implementation of search is a second place where the budget accounting can drift.

The other tool is [`record_vendor`](../../agent/subagents/scout/tools/record_vendor.ts), and it exists only under the scout. The root agent cannot record a vendor, and the scout cannot email one. Research and outreach never share a context.

### The absences have to be re-authored too

The root agent disables eve's default shell and filesystem tools. The scout does not receive those disablements. It receives its own default set, and it must disable those tools again. See [`agent/subagents/scout/tools/bash.ts`](../../agent/subagents/scout/tools/bash.ts):

```ts
import { disableTool } from "eve/tools";

// A researcher has no business running commands or writing files.
export default disableTool();
```

Six files in that directory contain only a comment and a `disableTool()`. One of those files is not about safety — [`todo.ts`](../../agent/subagents/scout/tools/todo.ts):

```ts
import { disableTool } from "eve/tools";

// A scout has one category and a search budget. It used two round trips per
// run keeping a to-do list, and a round trip here costs 10-30 seconds of
// model time — measured at 166s of one scout's 220s spent deciding what to
// call next. The list bought nothing that the budget does not already give.
export default disableTool();
```

The model *will* call each tool that it *can* call. Each call is a round trip, and the couple waits through each round trip. That cost is not a safety problem. It is still a reason to remove the tool.

The same rule applies to observability. The scout does not inherit hooks. Thus [`agent/subagents/scout/hooks/observe.ts`](../../agent/subagents/scout/hooks/observe.ts) re-exports the hook of the root agent. A scout that writes no trace is a scout that nobody can watch.

### A rule in a prompt is not a control

We released the scout, and the instructions named it as the only delegation path. But the built-in tool was still available. That condition caused the numbers at the top of this recipe. The correction is [`agent/tools/agent.ts`](../../agent/tools/agent.ts):

```ts
export default defineTool({
  description:
    "DEPRECATED — do not call. Use `scout` to delegate research. This tool does nothing.",
  inputSchema: z.object({
    message: z.string().optional(),
  }),
  execute() {
    return {
      status: "unavailable",
      note:
        "Generic delegation is disabled in this agent. Use the `scout` tool for research: it " +
        "is a specialist with its own search budget that records each vendor as it finds one, " +
        "and it cannot contact anyone. Re-issue this as a `scout` call with `CATEGORY: <category>` " +
        "on the first line.",
    };
  },
});
```

`disableTool()` does not operate here. It covers eve's *authored* framework tools, not the built-in delegate. An authored root tool with the same name has priority over the built-in tool. Thus the model receives the refusal instead.

**The refusal is a redirect, not a wall.** It names the correct tool, and it states what that tool can and cannot do. It also gives the exact first line for the new call. A refusal that only says no costs a round trip and teaches nothing.

Note that `agent` continues to appear in the manifest listing above. That is the intent: a harmless tool occupies the name.

### The findings leave through a tool, not a return value

The scout intentionally has no `outputSchema`. The comment in its definition explains the reason:

```ts
  // NO outputSchema, deliberately.
  //
  // It was here to guarantee a structured return, and it became the single
  // most brittle thing in the specialist tier: eve escalates a schema the
  // model cannot produce to OUTPUT_SCHEMA_NOT_FULFILLED, which fails the
  // whole child session. A run with DeepSeek-V4-Flash killed 10 of 10
  // specialists that way, several before they had searched even once.
  // …
```

The engineering log records two `npm run eval:scout` runs of the same fixed brief, both with the schema still in place:

```text
DeepSeek-V4-Flash · specialist sessions failed: 10 of 10 | vendors recorded: 0 | 10/22
Qwen/Qwen3-235B-A22B-Instruct-2507 · vendors per specialist: 3-4 | 46/50
```

Do not read only the scores. One model could satisfy the schema, and one model could not. Thus the schema was a dependency on the model, not a guarantee. Several of those ten sessions failed before they searched even once.

The schema was also redundant. Findings reach the root agent through `record_vendor` and the research store, and [`get_research`](../../agent/tools/get_research.ts) joins that store to the live trace. The closing message of the scout is prose, and the instructions tell the root agent to read findings from the store. The schema gave no benefit, and it could cause the loss of a full session.

### What this transfers to

The point is not weddings only. This pattern applies when a research step and an irreversible step are in the same agent, and the research must run in parallel. Examples: a procurement assistant collects supplier quotes and then places an order. A support agent reads a ticket history and then issues a refund. A recruiting agent finds candidates and then emails them. A coding agent reads a repository and then opens a pull request.

In each example, you want many instances of the fan-out step. You want exactly one instance of the commit step, and you keep that step in the session that a person watches.

## Failure modes

| Symptom | Cause | Handling |
| --- | --- | --- |
| A delegated child behaves like the root — same voice, same reach | The built-in `agent` tool runs a copy of the root agent, tools included | Declare a subagent under `agent/subagents/<name>/` and grant it only what the job needs |
| The model calls the built-in delegate anyway, despite instructions naming the specialist | An instruction is a preference; the tool is still in the schema offered on every step | Shadow it — an authored `tools/agent.ts` takes priority and returns a refusal that names the right tool |
| `disableTool()` on the built-in delegate has no effect | `disableTool()` covers eve's authored framework tools, not the built-in | Author a tool at that name instead |
| The specialist can run shell commands or write files you never granted | A declared subagent gets its own default framework tool set, not the root's disabled one | Re-author `disableTool()` under the subagent's own `tools/` directory |
| The specialist runs, but no child session appears in the trace | Hooks are not inherited — the root's `hooks/observe.ts` does not apply to a child | Re-export the root hook from the subagent's `hooks/` directory |
| Child sessions fail before doing any work, and a whole category comes back empty | `outputSchema` on the subagent — an unfulfillable schema escalates to `OUTPUT_SCHEMA_NOT_FULFILLED` and fails the session | Drop the schema; have the child write findings through a tool and report back in prose |

## Test it

```bash
npm run build:eve
jq -e -r '.tools[] | select(.name == "agent") | .logicalPath' .eve/agent-summary.json
npm run eval:scout
```

```text
tools/agent.ts
```

The `jq -e` command exits non-zero if that tool is not in the built manifest. This result proves that the build compiles the shadow into the deployed surface, and that the shadow is not only in the source tree. A pipe into `grep` would only report the status of `grep`.

The second command runs a fixed brief against the live deployment, and it waits for the fan-out to complete. Then it grades what the scouts recorded: coverage, distinct vendors, a contact path that operates, sources on the vendor's own site, addresses that belong to the vendor, a stated town, live URLs, venue photos, and two judge questions. A scout with an incorrect tool surface does not throw an error. It records nothing, and that is what this test finds.

## Going further

- **Give the scout its own budget, not the budget of the root agent.** [`agent/lib/search-budget.ts`](../../agent/lib/search-budget.ts) sets `SPECIALIST_SEARCH_CAP` to 25 and `ROOT_SEARCH_CAP` to 40. A scout needs room for many search iterations. The root agent only needs an occasional lookup between conversations. The unbounded search loop is the anti-pattern: a scout that continues to refine its query looks busy and finds nothing.
- **Split the model as well as the tools.** Input tokens across a long tool loop, not prose quality, cause most of the cost of a scout. For that reason, [`agent/lib/models.ts`](../../agent/lib/models.ts) keeps `planner` and `scout` as separate lines of configuration. Read the `scout` rationale before you change the model.
- **Put the boundary in the scout's own instructions also.** The Role section of [`agent/subagents/scout/instructions.md`](../../agent/subagents/scout/instructions.md) reads *you never contact anyone — no emails, no forms, no bookings. You have no way to, and you should never claim you did.* This is a double protection: the tool is absent, and the instructions tell the scout that the tool is absent. Thus the scout does not report an email that it did not send.
- **Next — [Durability: Record Findings as You Find Them](../03-record-findings-as-you-find-them/).** A stop can still occur in the middle of a scout run, and the found data must survive that stop. [`record_vendor`](../../agent/subagents/scout/tools/record_vendor.ts) and [`agent/lib/research.ts`](../../agent/lib/research.ts) exist for that reason. This need is also why the scout reports back in prose and not in a closing array.

## License


This recipe is part of the [Venus](../../README.md) repository. The repository has no LICENSE file, and thus it grants no reuse rights by default.
