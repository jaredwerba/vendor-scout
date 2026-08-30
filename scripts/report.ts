/**
 * The evidence pack.
 *
 * Nebius's production-agent thesis makes three claims that a demo cannot
 * answer and a traced system can:
 *
 *   "95% success at each step is roughly 60% across a ten-step workflow."
 *   "Cost has long tails."
 *   "Traces without an eval loop fail the same way forever."
 *
 * This reads every session Venus has actually run and answers all three with
 * its own numbers, then prints the generation table those numbers came from.
 * Nothing here is illustrative — every row is a session id you can open in
 * /observe.
 *
 *   npm run report
 */
import { readFileSync } from "node:fs";
import { modelIdFor } from "../agent/lib/models.ts";
import { formatUsd } from "../agent/lib/pricing.ts";
import { fleetStats } from "../agent/lib/report.ts";
import { listEvalSummaries, traceConfigured } from "../agent/lib/trace.ts";

interface Generation {
  gen: number;
  name: string;
  config: string;
  scoutScore: string | null;
  sessionId: string | null;
  solved: string;
  exposed: string;
}

const generations = JSON.parse(
  readFileSync(new URL("../evals/data/generations.json", import.meta.url), "utf8"),
) as Generation[];

if (!traceConfigured()) {
  console.error("No trace store configured (KV_REST_API_URL / KV_REST_API_TOKEN).");
  process.exit(1);
}

const stats = await fleetStats(100);

const line = (s: string) => console.log(s);
const rule = () => line("─".repeat(78));

line("\nVENUS — EVIDENCE PACK");
line(
  `${stats.sessions} traced sessions · ${stats.agentSessions} agent sessions · ` +
    `${formatUsd(stats.totalCostUsd)} of real inference`,
);

// ── 1. Step-level reliability, and what it compounds to ───────────────────
rule();
line("\n1. STEP RELIABILITY COMPOUNDS");
line(
  `\n   ${stats.toolCalls} tool calls across every agent, ${stats.failedActions} failed ` +
    `→ ${(stats.actionSuccess * 100).toFixed(1)}% per action`,
);
line("\n   What that rate survives, if every step must succeed:");
for (const { steps, probability } of stats.compounding) {
  const bar = "█".repeat(Math.round(probability * 34)).padEnd(34, "·");
  line(`     ${String(steps).padStart(2)} steps  ${bar} ${(probability * 100).toFixed(1)}%`);
}
if (stats.medianRealRun) {
  line(
    `\n   A median run that actually fans out: ${stats.medianRealRun.steps} steps across ` +
      `${stats.medianRealRun.agents} agents. A single specialist runs 20-40 of them.`,
  );
}
line("   This is why findings are written down per vendor as they are found,");
line("   and why a truncated or failed step is recorded rather than retried blindly:");
line(`   ${stats.truncations} truncations are visible in these traces instead of silent.`);

// ── 2. Cost long tails ────────────────────────────────────────────────────
rule();
line("\n2. COST HAS LONG TAILS");
if (stats.cost) {
  const worst = [...stats.runs].sort((a, b) => b.costUsd - a.costUsd)[0];
  line(`\n   ${stats.cost.n} runs with real spend`);
  line(`     median   ${formatUsd(stats.cost.median)}`);
  line(`     p90      ${formatUsd(stats.cost.p90)}`);
  line(`     max      ${formatUsd(stats.cost.max)}   ${worst.agents} agents, ${worst.steps} steps`);
  line(`     ratio    ${stats.cost.ratio.toFixed(1)}× median`);
  line("\n   The tail is not the model being expensive — it is an agent that would not stop.");
  line("   Which is what the per-session search budgets bound, and why cost is");
  line("   reported per agent in the app rather than per plan.");
}

// ── 3. Traces without an eval loop fail the same way forever ──────────────
rule();
line("\n3. THE EVAL LOOP");
const evals = await listEvalSummaries();
for (const e of evals) {
  line(
    `\n   ${e.kind.padEnd(9)} ${String(e.passed).padStart(3)}/${String(e.n).padEnd(3)} ` +
      `${e.incomplete ? "  —  " : `${(e.score * 100).toFixed(0)}%   `}${e.name.slice(0, 52)}`,
  );
  if (e.model) line(`             model ${e.model.slice(0, 60)}`);
  if (e.incomplete) line(`             NOT SCORED — ${e.incomplete.slice(0, 74)}`);
}

// ── 4. Generations ────────────────────────────────────────────────────────
rule();
line("\n4. FIVE GENERATIONS OF THE SAME AGENT");
line("   Same brief every time: $45k, Methuen MA, 110 guests, boho farm, September.\n");
for (const g of generations) {
  line(`   GEN ${g.gen} · ${g.name}${g.scoutScore ? `  —  ${g.scoutScore}` : ""}`);
  line(`     config   ${g.config}`);
  line(`     solved   ${g.solved}`);
  line(`     exposed  ${g.exposed}`);
  if (g.sessionId) line(`     session  ${g.sessionId}`);
  line("");
}

rule();
line("\nRouting today:");
for (const role of ["planner", "scout", "classifier", "judge"] as const) {
  line(`   ${role.padEnd(11)} ${modelIdFor(role)}`);
}
line("\nEvery number above came from a live run against production. Reproduce with:");
line("   npm run eval:replies · npm run eval:scout · npm run models:compare · npm run probe:schema\n");
