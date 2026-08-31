# The system map

`public/venus-architecture.html` is a self-contained interactive diagram of V2 — linked from
[`/compare`](../app/compare/page.tsx) and declared as `assets.architecture` in
[`blueprint.json`](../blueprint.json), the field the Nebius blueprint schema reserves for exactly
this and which pointed at prose until now.

It moves, but it is **not a live view** and must never be mistaken for one. The observability rail
on the front door and `/observe` render real trace events as the specialists work; this renders a
drawing. Its motion is authored, finite and reader-controlled — a Live/Still toggle and a
five-chapter guided story — and reduced motion, a hidden page, print and every canonical export
still carry the complete static meaning. What it answers is the question the rail cannot: not
*what is happening right now* but *what is this thing*.

## Regenerating it

The source of truth is `docs/venus.architecture.json`, a typed IR. The renderer is
[archify](https://github.com/tt-a1i/archify) (MIT, by tt-a1i), used as a local CLI — it is **not a
dependency of this app**, nothing ships to the browser from it, and the committed HTML is the whole
artifact.

```bash
git clone --depth 1 https://github.com/tt-a1i/archify.git /tmp/archify
node /tmp/archify/archify/bin/archify.mjs validate architecture docs/venus.architecture.json --quality showcase
node /tmp/archify/archify/bin/archify.mjs deliver  architecture docs/venus.architecture.json public/venus-architecture.html --quality showcase
shasum -a 256 docs/venus.architecture.json | cut -d' ' -f1 > docs/venus.architecture.sha256
```

**Refresh the stamp in the same commit.** `npm run verify` runs
`scripts/check-architecture-drift.mjs`, which fails if the IR has changed since the artifact was
delivered — the renderer is not a dependency of this repo, so nothing else would notice a stale
map on a page linked from every nav.

`meta.animation` (`"trace"`) and `meta.views` (at most five chapters) are the motion fields. A
chapter's `focus` must step only between components joined by an authored connection: the renderer
refuses to infer an edge, a verb or a causal claim from story order, and neither should the tour.

`validate` at `--quality showcase` is the gate: it fails on an edge that crosses an unrelated
component, a label that overlaps a box, or a turn with too little room to read. The committed
artifact passes all nine artifact checks with zero composition errors and zero warnings.

## What the map asserts

Every claim on it is checkable in this repository, which is the same rule the cookbook follows:

| On the map | In the code |
|---|---|
| a scout reaches only `web_search` and `record_vendor` | `agent/subagents/scout/tools/` — six other tools are `disableTool()` shells |
| six guards at the write boundary | `record_vendor.ts` returns six `rejected_*` statuses, in that order |
| Nominatim feeds the radius check | `outsideRadius()` — the only network call in a guard besides liveness |
| findings land in KV per vendor | `agent/lib/research.ts`, one `HSET` per finding |
| `send_outreach` sits under the planner, never under a scout | `agent/tools/send_outreach.ts` is a root tool; the scout has no path to it |

## Known limitations of the renderer

Found by review of the animation commit, verified in the artifact, and **not fixed here** — they
live in archify's generated viewer code. Hand-patching generated output is the drift
`scripts/check-architecture-drift.mjs` exists to prevent, and any edit would be lost the next time
the map is delivered. They are worth knowing before quoting an export.

| What | Evidence in `public/venus-architecture.html` | Consequence |
|---|---|---|
| The WebM recorder selects node shapes with the compound selector `[data-node-id][data-animate="node"]`, but `data-node-id` sits on the `<g>` and `data-animate` on its child `<rect>` | that compound pattern matches **0** elements; the same file uses the correct descendant form elsewhere | Export → WebM records edge motion only; the boxes stay inert in the video while the live page pulses them |
| The `@media print` block resets `animation: none` for focus/story/route states but not for the ambient trace pass | 13 `animation: none` resets, none covering the plain ambient state | Printing during the trace window can capture connectors mid-keyframe. PNG/SVG/WebM export clones strip `data-animate` and are unaffected |
| Emitted `--step` delays collide and skip | `--step:5` appears three times; `--step:7` and `--step:8` appear once each | Two unrelated nodes pulse together, with a dead beat later in the sequence |
| `authoredStep()`'s fallback is unreachable — an absent `--step` yields `Number('') === 0`, which is finite | latent; the generator emits `--step` on every animated element | No effect on this artifact. Any hand-added animated element would pile onto delay 0 |

None of these change what the diagram *asserts*. Static meaning, the guided chapters, and the
PNG/SVG exports are unaffected; the WebM row is the only one that alters a deliverable, and it
degrades to less motion rather than to a wrong picture.
