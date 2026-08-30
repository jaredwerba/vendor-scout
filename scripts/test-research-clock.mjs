/**
 * The research wall-clock starts on the last context message, not on the
 * opening budget line and not on the interview question.
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
  scout: type === "subagent.called" || type === "actions.requested",
  gate: type === "input.requested",
  ...flags,
});

console.log("\nstarts on the last context message, not the budget line");
{
  const clock = deriveResearchClock([
    ev("message.received", 1_000),
    ev("message.received", 5_000),
    ev("subagent.called", 6_000, { scout: true }),
    ev("input.requested", 400_000),
  ]);
  check("startedAt", clock.startedAt, 5_000);
  check("endedAt", clock.endedAt, 400_000);
}

console.log("\ninterview gate before any scout is ignored");
{
  const clock = deriveResearchClock([
    ev("message.received", 1_000),
    ev("input.requested", 2_000, { scout: false }),
    ev("message.received", 8_000),
    ev("subagent.called", 9_000, { scout: true }),
    ev("input.requested", 300_000),
  ]);
  check("startedAt", clock.startedAt, 8_000);
  check("endedAt", clock.endedAt, 300_000);
}

console.log("\nfallback: last user send when the stream has no timestamps");
{
  const clock = deriveResearchClock(
    [ev("subagent.called", null, { scout: true })],
    { fallbackUserAt: 12_345 },
  );
  check("startedAt", clock.startedAt, 12_345);
  check("endedAt while running", clock.endedAt, null);
}

console.log("\nstill running: do not freeze on the last event");
{
  const clock = deriveResearchClock(
    [ev("message.received", 1_000), ev("subagent.called", 2_000, { scout: true })],
    { stillRunning: true },
  );
  check("startedAt", clock.startedAt, 1_000);
  check("endedAt", clock.endedAt, null);
}

console.log("\nsettled without a gate: freeze on the last stamped event");
{
  const clock = deriveResearchClock(
    [
      ev("message.received", 1_000),
      ev("subagent.called", 2_000, { scout: true }),
      { type: "turn.completed", at: 90_000, user: false, scout: false, gate: false },
    ],
    { stillRunning: false },
  );
  check("endedAt", clock.endedAt, 90_000);
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
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nok");
