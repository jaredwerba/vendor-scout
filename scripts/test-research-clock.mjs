/**
 * The plan wall-clock starts on the last context message and closes only at
 * the gate that FOLLOWS save_wedding_plan. Gates before any save — the
 * interview, the venue pick — leave it running: the plan is still being
 * built, and a frozen "DONE" at the venue pick made phase 2 look dead.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/test-research-clock.mjs
 */
import { deriveResearchClock, formatElapsed } from "../agent/lib/research-clock.ts";

let failures = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label.padEnd(56)} ${ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`,
  );
}

const ev = (type, at, flags = {}) => ({
  type,
  at,
  user: type === "message.received",
  scout: type === "subagent.called",
  gate: type === "input.requested",
  save: false,
  ...flags,
});
const save = (at) => ev("actions.requested", at, { save: true });

console.log("\nstarts on the last context message, not the budget line");
{
  const clock = deriveResearchClock([
    ev("message.received", 1_000),
    ev("message.received", 5_000),
    ev("subagent.called", 6_000),
    save(300_000),
    ev("input.requested", 400_000),
  ]);
  check("startedAt", clock.startedAt, 5_000);
  check("endedAt at the post-save gate", clock.endedAt, 400_000);
}

console.log("\nthe venue pick (a gate before any save) keeps the clock running");
{
  const clock = deriveResearchClock(
    [
      ev("message.received", 5_000),
      ev("subagent.called", 6_000),
      ev("input.requested", 200_000), // the venue gate — no save yet
      ev("subagent.called", 260_000), // phase-2 scouts
    ],
    { stillRunning: true },
  );
  check("startedAt", clock.startedAt, 5_000);
  check("endedAt stays open through the venue pick", clock.endedAt, null);
}

console.log("\nthe full phased flow closes at the plan gate only");
{
  const clock = deriveResearchClock([
    ev("message.received", 5_000),
    ev("subagent.called", 6_000),
    ev("input.requested", 200_000), // venue gate
    ev("subagent.called", 260_000), // service scouts
    save(500_000),
    ev("input.requested", 520_000), // the plan gate
  ]);
  check("startedAt", clock.startedAt, 5_000);
  check("endedAt", clock.endedAt, 520_000);
}

console.log("\ninterview gate before any scout is ignored");
{
  const clock = deriveResearchClock([
    ev("message.received", 1_000),
    ev("input.requested", 2_000),
    ev("message.received", 8_000),
    ev("subagent.called", 9_000),
    save(250_000),
    ev("input.requested", 300_000),
  ]);
  check("startedAt", clock.startedAt, 8_000);
  check("endedAt", clock.endedAt, 300_000);
}

console.log("\nfallback: last user send when the stream has no timestamps");
{
  const clock = deriveResearchClock(
    [ev("subagent.called", null)],
    { fallbackUserAt: 12_345 },
  );
  check("startedAt", clock.startedAt, 12_345);
  check("endedAt while running", clock.endedAt, null);
}

console.log("\nstill running: do not freeze on the last event");
{
  const clock = deriveResearchClock(
    [ev("message.received", 1_000), ev("subagent.called", 2_000)],
    { stillRunning: true },
  );
  check("startedAt", clock.startedAt, 1_000);
  check("endedAt", clock.endedAt, null);
}

console.log("\nsettled after a save but without a gate: freeze on the last event");
{
  const clock = deriveResearchClock(
    [
      ev("message.received", 1_000),
      ev("subagent.called", 2_000),
      save(80_000),
      { type: "turn.completed", at: 90_000, user: false, scout: false, gate: false, save: false },
    ],
    { stillRunning: false },
  );
  check("endedAt", clock.endedAt, 90_000);
}

console.log("\nsettled UNSAVED: the clock stays open — the plan never finished");
{
  const clock = deriveResearchClock(
    [
      ev("message.received", 1_000),
      ev("subagent.called", 2_000),
      { type: "turn.completed", at: 90_000, user: false, scout: false, gate: false, save: false },
    ],
    { stillRunning: false },
  );
  check("endedAt", clock.endedAt, null);
}

console.log("\nno research yet");
{
  const clock = deriveResearchClock([ev("message.received", 1_000)]);
  check("startedAt", clock.startedAt, null);
  check("endedAt", clock.endedAt, null);
}

console.log("\nformatElapsed");
{
  check("under a minute", formatElapsed(4_000), "0:04");
  check("minutes", formatElapsed(125_000), "2:05");
  check("hours", formatElapsed(3_661_000), "1:01:01");
}

if (failures) {
  console.log(`\nresearch clock: ${failures} MISMATCHES`);
  process.exit(1);
}
console.log("\nresearch clock: all boundaries hold");
