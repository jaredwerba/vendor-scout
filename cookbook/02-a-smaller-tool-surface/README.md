# Delegation — Give the Specialist a Smaller Tool Surface

> The capability a sub-agent must not have is the one it should not be given.

Recipe **02 of 10** in the Venus Blueprint Recipes arc:

> Foundation → **Delegation** → Durability → Guards → Governance → Cost → Latency → Observability → Evaluation → Verification

Venus plans a wedding by fanning out: one research specialist per category, up to five at once, each digging through the open web for venues, caterers, photographers, florists, music. The first version delegated with eve's built-in `agent` tool. Nothing looked wrong — the plans were good, the builds were green, no run failed.

The built-in runs a copy of the *root* agent: same instructions, same tools. The root's tools include `send_outreach`, which puts a real email in a real stranger's inbox. So every research child was also an outreach agent. Nobody decided that. The capability arrived by inheritance, and a researcher was one bad inference away from using it.

Research moved into a declared subagent with no such tool. A production session traced after that change still shows this:

```text
scout calls: 10 | agent calls: 3 | session: 1
```

The guardrails section of [`agent/instructions.md`](../../agent/instructions.md) states that `scout` is the planner's *only* way to delegate. The interesting number is not three. It is that the sentence forbidding those three calls was in the context window for every one of them.

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
      hooks/
        observe.ts                  # re-export: a child nobody can watch is not observable
  lib/
    models.ts                       # planner and scout are separate roles
    search-budget.ts                # the specialist's cap is not the root's
    research.ts                     # where record_vendor lands
```

## Prerequisites

- Node 24.x — the `engines` pin in `package.json` — and this repository checked out. The commands below inspect the real agent, not a sample.
- `eve` ^0.24.4. `eve build` writes the manifest the checks read.
- `jq`, for reading `.eve/agent-summary.json`.
- `NEBIUS_API_KEY` in `.env.local` if you intend to *run* the agent rather than only inspect its surface.
- A look at [`agent/lib/models.ts`](../../agent/lib/models.ts) first: `planner` and `scout` are separate roles, and this recipe assumes you know why.

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
$ jq -r ".tools[].name" .eve/agent-summary.json
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

$ jq -r ".subagents[].name" .eve/agent-summary.json
scout

$ grep -L disableTool agent/subagents/scout/tools/*.ts
agent/subagents/scout/tools/record_vendor.ts
agent/subagents/scout/tools/web_search.ts
```

Those two listings are the whole recipe. `send_outreach` appears in one of them and not the other, and no sentence anywhere is responsible for keeping it that way.

## Walk-through

### The built-in delegate is a clone, not a specialist

eve ships an `agent` tool. Calling it starts a child session running a copy of the root agent — same instructions, same tools. That is a genuinely useful default for "go do this same job on a different input", and it is exactly wrong for "go do a *narrower* job".

**Inheritance is the failure, not the child.** The child agent never misbehaved. It searched, it summarised, it came back. But its tool set included the one tool that reaches outside the process, and the only thing standing between a wedding inquiry and a stranger's inbox was the model choosing not to call it.

### A declared subagent inherits nothing

A directory under `agent/subagents/` with its own `agent.ts` is a different agent, not a copy. From [`agent/subagents/scout/agent.ts`](../../agent/subagents/scout/agent.ts):

```ts
export default defineAgent({
  description:
    "Researches ONE wedding-vendor category (venue, photography, catering, florals, music, " +
    "styling) against a couple's brief and budget, and returns 3-4 real, currently-operating " +
    "vendors with published contact details, price signals and source links. Reads the web " +
    "only — it never contacts a vendor.",
  model: modelFor("scout"),
  modelContextWindowTokens: contextWindowFor("scout"),
```

The `description` states the boundary — *it never contacts a vendor* — in the same place the capability is advertised. **State the choice, then name the failure the choice avoids.** The scout has no `send_outreach` import, no `send_outreach` file under its `tools/`, and therefore no `send_outreach` in the schema it sees.

### Two tools, and one of them is a re-export

[`agent/subagents/scout/tools/web_search.ts`](../../agent/subagents/scout/tools/web_search.ts) is four lines:

```ts
// The same Tavily-backed search the root uses (agent/tools/web_search.ts).
// Declared subagents inherit nothing, so the capability is re-exported here
// rather than duplicated — one implementation, one search budget helper.
export { default } from "../../../tools/web_search";
```

Inheriting nothing cuts both ways: every capability you *do* want has to be granted explicitly. Re-export rather than copy — a forked second implementation of search is a second place for the budget accounting to drift.

The other tool is [`record_vendor`](../../agent/subagents/scout/tools/record_vendor.ts), and it exists only under the subagent. The root has no way to record a vendor and the scout has no way to email one. Research and outreach never share a context.

### The absences have to be re-authored too

The root disables eve's default shell and filesystem tools. The scout does not get those disablements — it gets its own default set, and has to disable them again. [`agent/subagents/scout/tools/bash.ts`](../../agent/subagents/scout/tools/bash.ts):

```ts
import { disableTool } from "eve/tools";

// A researcher has no business running commands or writing files.
export default disableTool();
```

Six files in that directory are a comment and a `disableTool()`. One of them is not about safety at all — [`todo.ts`](../../agent/subagents/scout/tools/todo.ts):

```ts
// A scout has one category and a search budget. It used two round trips per
// run keeping a to-do list, and a round trip here costs 10-30 seconds of
// model time — measured at 166s of one scout's 220s spent deciding what to
// call next. The list bought nothing that the budget does not already give.
export default disableTool();
```

A tool the model *can* call is a tool the model *will* call, and every call it makes is a round trip the couple waits through. That cost is not a safety problem. It is still a reason to remove the tool.

The same rule reaches the observability plane. [`agent/subagents/scout/hooks/observe.ts`](../../agent/subagents/scout/hooks/observe.ts) re-exports the root's hook, because hooks are not inherited either — and a specialist that writes no trace is a specialist nobody can watch fail.

### A rule in a prompt is not a control

The scout shipped, the instructions named it as the only delegation path, and the built-in was still there. Hence the strip in the hook. The fix is [`agent/tools/agent.ts`](../../agent/tools/agent.ts):

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

`disableTool()` does not work here — it covers eve's *authored* framework tools, not the built-in delegate. An authored root tool at the same name takes priority over the built-in, so the refusal is what the model gets instead. **The refusal is a redirect, not a wall.** It names the correct tool, states what that tool can and cannot do, and gives the exact first line to re-issue with. A refusal that only says no costs a round trip and teaches nothing.

Notice that `agent` still shows up in the manifest listing above. That is the point: the name is occupied, by something harmless.

### The findings leave through a tool, not a return value

The scout deliberately has no `outputSchema`, and the comment in its definition explains what that bought:

```ts
  // NO outputSchema, deliberately.
  //
  // It was here to guarantee a structured return, and it became the single
  // most brittle thing in the specialist tier: eve escalates a schema the
  // model cannot produce to OUTPUT_SCHEMA_NOT_FULFILLED, which fails the
  // whole child session.
```

Two runs of the same fixed brief through `npm run eval:scout`, both with the schema still in place:

```text
DeepSeek-V4-Flash · specialist sessions failed: 10 of 10 | vendors recorded: 0 | 10/22
Qwen/Qwen3-235B-A22B-Instruct-2507 · vendors per specialist: 3-4 | 46/50
```

Read past the scores. The schema was survivable on one model and lethal on another, which makes it a dependency on the model rather than a guarantee — and several of those ten sessions died before they had searched even once. It was also redundant. Findings reach the planner through `record_vendor` and the research store, which [`get_research`](../../agent/tools/get_research.ts) joins to the live trace; the child's closing message is prose, and nothing reads it. The schema bought nothing and could cost everything.

### What this transfers to

The point is not weddings specifically. This pattern transfers to any domain where a researching step and an irreversible step live in the same agent, and where the research is the part you want to parallelise: a procurement assistant that gathers supplier quotes and then places an order; a support agent that reads a ticket history and then issues a refund; a recruiting agent that sources candidates and then emails them; a coding agent that reads a repository and then opens a pull request. In every one of those, the fan-out step is the one you want many of and the commit step is the one you want exactly one of — held in the session a human is actually watching.

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

The `jq -e` exits non-zero if that tool is not in the built manifest, which proves the shadow is compiled into the deployed surface rather than merely present in the source tree — piping into `grep` would only have told you about `grep`. The second drives a fixed brief against the live deployment, waits for the fan-out to settle, and grades what the specialists actually recorded — coverage, distinct vendors, a working contact path, sources on the vendor's own site, addresses that belong to the vendor, a stated town, live URLs, venue photos, and two judge questions. A specialist whose tool surface is wrong does not throw; it records nothing, and that is what this catches.

## Going further

- **Give the specialist its own budget, not the root's.** [`agent/lib/search-budget.ts`](../../agent/lib/search-budget.ts) sets `SPECIALIST_SEARCH_CAP` to 25 and `ROOT_SEARCH_CAP` to 40 — a research child needs room to iterate, the root only needs the occasional lookup between conversations. The anti-pattern is the unbounded search loop: a specialist that keeps refining its query looks busy and converges on nothing.
- **Split the model as well as the tools.** A specialist's cost is dominated by input tokens across a long tool loop, not by prose quality, and [`agent/lib/models.ts`](../../agent/lib/models.ts) keeps `planner` and `scout` as separate lines of config for exactly that reason. Read the `scout` rationale before you swap it.
- **Put the boundary in the child's own instructions too.** The Role section of [`agent/subagents/scout/instructions.md`](../../agent/subagents/scout/instructions.md) reads *you never contact anyone — no emails, no forms, no bookings. You have no way to, and you should never claim you did.* Belt and braces: the tool is absent, and the agent is told it is absent, so it does not hallucinate having sent something.
- **Next — [Durability: Record Findings as You Find Them](../03-record-findings-as-you-find-them/).** A narrow specialist can still be cut off mid-run, and what it already found has to survive that. That is what [`record_vendor`](../../agent/subagents/scout/tools/record_vendor.ts) and [`agent/lib/research.ts`](../../agent/lib/research.ts) exist for, and it is why the scout reports back in prose instead of a closing array.

## License


Part of the [Venus](../../README.md) repository, which carries no LICENSE file — no reuse rights are granted by default.
