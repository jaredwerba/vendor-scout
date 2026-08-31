# The system map

`public/venus-architecture.html` is a self-contained interactive diagram of V2 — linked from
[`/compare`](../app/compare/page.tsx) and declared as `assets.architecture` in
[`blueprint.json`](../blueprint.json), the field the Nebius blueprint schema reserves for exactly
this and which pointed at prose until now.

It is **static on purpose.** The live view of a run in flight already exists and is the better tool
for it: the observability rail on the front door and `/observe` render real trace events as the
specialists work. A generated picture cannot do that and should not pretend to. What it does
instead is answer the question the rail cannot — not *what is happening right now* but *what is
this thing*.

## Regenerating it

The source of truth is `docs/venus.architecture.json`, a typed IR. The renderer is
[archify](https://github.com/tt-a1i/archify) (MIT, by tt-a1i), used as a local CLI — it is **not a
dependency of this app**, nothing ships to the browser from it, and the committed HTML is the whole
artifact.

```bash
git clone --depth 1 https://github.com/tt-a1i/archify.git /tmp/archify
node /tmp/archify/archify/bin/archify.mjs validate architecture docs/venus.architecture.json --quality showcase
node /tmp/archify/archify/bin/archify.mjs deliver  architecture docs/venus.architecture.json public/venus-architecture.html --quality showcase
```

`validate` at `--quality showcase` is the gate: it fails on an edge that crosses an unrelated
component, a label that overlaps a box, or a turn with too little room to read. The committed
artifact passes all nine artifact checks with zero composition errors and zero warnings.

## What the map asserts

Every claim on it is checkable in this repository, which is the same rule the cookbook follows:

| On the map | In the code |
|---|---|
| a scout reaches only `web_search` and `record_vendor` | `agent/subagents/scout/tools/` — six other tools are `disableTool()` shells |
| five guards at the write boundary | `agent/lib/vendor-guards.ts`, called in order in `record_vendor.ts` |
| Nominatim feeds the radius check | `outsideRadius()` — the only network call in a guard besides liveness |
| findings land in KV per vendor | `agent/lib/research.ts`, one `HSET` per finding |
| `send_outreach` sits under the planner, never under a scout | `agent/tools/send_outreach.ts` is a root tool; the scout has no path to it |
