# Runs

One `RunResult` per system per brief — the raw measurements behind the
comparison in `docs/`. Committed on purpose: a benchmark you cannot re-read is
an assertion.

Each file conforms to `evals/harness/run-result.schema.json` and is produced
by a collector that does no grading:

```bash
npm run run:eve -- boston-boho          # Approach A: eve on Vercel
# (Approach B collector writes the same shape)

npm run grade -- runs/eve-boston-boho.json runs/graph-boston-boho.json
```

`scripts/grade.ts` is the only thing that turns these into a score, and it
sees nothing about either stack beyond the `system` label. Two graders that
"do the same thing" is how a comparison quietly becomes marketing.
