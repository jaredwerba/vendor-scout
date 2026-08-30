/**
 * The fold, asserted against events shaped the way eve actually delivers them.
 *
 * Two rounds of review found bugs in agent/lib/trace.ts that no test could
 * see, because nothing ever called the fold. `actionOutcome` had unit
 * coverage; the code that *consumes* it did not, so a refusal counted as a
 * failure, a capped search counted as a search, and a hard failure with no
 * message wrote a blank note — all with a green suite.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/test-trace-fold.mjs
 */
import { apply, fresh, toolRuns } from "../agent/lib/trace.ts";

const NOW = "2026-08-29T00:00:00.000Z";
let failures = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(52)} ${ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

/** eve's shapes, from node_modules/eve/dist/src/protocol/message.js. */
const requested = (toolName) => ({
  type: "actions.requested",
  data: { actions: [{ kind: "tool-call", callId: "c1", toolName, input: {} }] },
});
const softResult = (toolName, status) => ({
  type: "action.result",
  data: { status: "completed", result: { kind: "tool-result", toolName, output: { status } } },
});
const rejected = (toolName) => ({
  type: "action.result",
  data: {
    status: "rejected",
    error: { code: "ACTION_RESULT_FAILED", message: "denied" },
    result: { kind: "tool-result", toolName, output: {} },
  },
});
const hardFailure = (toolName) => ({
  type: "action.result",
  data: { status: "failed", result: { kind: "tool-result", toolName, output: {}, isError: true } },
});

const run = (events) => {
  const s = fresh("s1", NOW, { sessionId: "root", rootSessionId: "root", callId: "c0" });
  const rows = events.map((e) => apply(s, e, NOW));
  return { s, rows };
};

console.log("\nrefusals are not failures");
{
  const { s } = run([requested("record_vendor"), softResult("record_vendor", "rejected_directory_source")]);
  check("refusedActions", s.refusedActions, 1);
  check("failedActions stays 0", s.failedActions, 0);
  check("vendorsRecorded stays 0", s.vendorsRecorded, 0);
}

console.log("\na search refused at the cap is not a search");
{
  const { s } = run([
    requested("web_search"), softResult("web_search", "ok"),
    requested("web_search"), softResult("web_search", "cap_reached"),
  ]);
  check("web_search calls requested", s.tools.web_search, 2);
  check("searches actually performed", toolRuns(s, "web_search"), 1);
}

console.log("\nan approval-gate denial is a refusal, and says so");
{
  const { s, rows } = run([requested("send_outreach"), rejected("send_outreach")]);
  check("refusedActions", s.refusedActions, 1);
  check("failedActions", s.failedActions, 0);
  check("note", rows[1].note, "declined at the approval gate");
}

console.log("\nno failed row is ever blank, no successful row is noisy");
{
  const { rows } = run([requested("check_timeline"), hardFailure("check_timeline")]);
  check("failure with no message still explains itself", rows[1].note, "failed");
}
{
  const { rows } = run([requested("record_vendor"), softResult("record_vendor", "recorded")]);
  check("successful record_vendor carries no note", rows[1].note, undefined);
  check("ok", rows[1].ok, true);
}

console.log("\nan unknown status never inflates the vendor count");
{
  const { s } = run([requested("record_vendor"), softResult("record_vendor", "some_future_guard")]);
  check("vendorsRecorded", s.vendorsRecorded, 0);
}
{
  const { s } = run([requested("record_vendor"), softResult("record_vendor", "recorded")]);
  check("a known success does count", s.vendorsRecorded, 1);
}

console.log("\ncounters survive a summary that predates them");
{
  const s = fresh("s2", NOW);
  delete s.refusedActions;
  delete s.toolsRefused;
  delete s.toolResults;
  apply(s, requested("web_search"), NOW);
  apply(s, softResult("web_search", "cap_reached"), NOW);
  check("refusedActions", s.refusedActions, 1);
  check("toolResults", s.toolResults, 1);
  check("toolRuns", toolRuns(s, "web_search"), 0);
}

console.log(failures === 0 ? "\ntrace fold: correct" : `\n${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
