/**
 * Approach A under test: Venus on eve, deployed on Vercel.
 *
 * Drives one fixed brief end to end against a running deployment, waits for
 * the specialist fan-out to settle, then writes a RunResult
 * (evals/harness/run-result.schema.json). It does no grading — scripts/grade.ts
 * scores this and the LangGraph run with identical code.
 *
 *   npm run run:eve -- boston-boho [https://vendor-scout-xi.vercel.app]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "eve/client";
import type { AgentFacts, FindingFacts, RunResult } from "../evals/harness/types.ts";
import { listAllFindings } from "../agent/lib/research.ts";
import { agentCost } from "../agent/lib/pricing.ts";
import { getTraceTree, readCount, toolRuns } from "../agent/lib/trace.ts";
import { traceUrl } from "../agent/lib/langsmith.ts";

interface Brief {
  id: string;
  budget: number;
  region: string;
  message: string;
}
const briefs = JSON.parse(
  readFileSync(new URL("../evals/data/briefs.json", import.meta.url), "utf8"),
) as Brief[];

const args = process.argv.slice(2);
const briefId = args.find((a) => !a.startsWith("http") && !a.startsWith("-")) ?? briefs[0].id;
const host = args.find((a) => a.startsWith("http")) ?? "https://vendor-scout-xi.vercel.app";
const brief = briefs.find((b) => b.id === briefId);
if (!brief) {
  console.error(`unknown brief "${briefId}" — have: ${briefs.map((b) => b.id).join(", ")}`);
  process.exit(1);
}

const TURN_TIMEOUT_MS = Number(process.env.EVAL_TURN_TIMEOUT_MS ?? 15 * 60 * 1000);
const SETTLE_MS = Number(process.env.EVAL_SETTLE_TIMEOUT_MS ?? 12 * 60 * 1000);
const MAX_TURNS = 3;

console.log(`eve · ${brief.id} · $${brief.budget.toLocaleString("en-US")} · ${brief.region}`);
const t0 = Date.now();
const session = new Client({ host }).session();

let sessionId: string | null = null;
let status: RunResult["status"] = "failed";
let delegated = 0;
const nudges = [
  brief.message,
  "That's everything — please start the research now.",
  "Go ahead and start researching, I have nothing else to add.",
];

try {
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await session.send({
      message: nudges[Math.min(turn, nudges.length - 1)],
      signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    });
    sessionId = response.sessionId ?? sessionId;
    if (turn === 0) console.log(`session ${sessionId}`);
    const result = await response.result();
    status = result.status === "failed" ? "failed" : result.status === "completed" ? "completed" : "waiting";
    // subagent.called is not delivered on the parent stream in eve 0.24.4;
    // the delegation request is where it is observable.
    delegated += result.events
      .filter((e) => e.type === "actions.requested")
      .reduce(
        (n, e) =>
          n +
          (((e.data as { actions?: readonly unknown[] }).actions ?? []) as readonly {
            kind?: string;
          }[]).filter((a) => a?.kind === "subagent-call").length,
        0,
      );
    console.log(`  turn ${turn + 1}: ${status} · ${delegated} specialists so far`);
    if (delegated > 0 || status === "failed") break;
  }
} catch (error) {
  status = "timeout";
  console.log(`  turn error: ${String((error as Error)?.message ?? error).slice(0, 120)}`);
}

if (!sessionId) {
  console.error("no session id — nothing to record");
  process.exit(1);
}

// The parent turn settles as soon as the scouts are dispatched; the work
// continues in the children, so wait for the tree to go quiet.
//
// The reason is carried, not just logged, because this collector writes a
// RunResult either way and parks the status at "waiting" either way. Without
// it the grader cannot tell a finished fan-out from one abandoned mid-search,
// and publishes the second as a percentage on /observe.
let incomplete: string | null = null;
const deadline = Date.now() + SETTLE_MS;
for (;;) {
  const snapshot = await getTraceTree(sessionId).catch(() => null);
  const kids = snapshot?.children ?? [];
  const running = kids.filter((c) => c.status === "active");
  if (kids.length > 0 && running.length === 0) {
    console.log(`  specialists settled (${kids.length})`);
    break;
  }
  if (Date.now() > deadline) {
    const stalled =
      kids.length === 0
        ? "no specialists ever appeared"
        : `${running.length} of ${kids.length} specialists were still active`;
    incomplete =
      `${stalled} after ${SETTLE_MS / 1000}s — these findings were read from a run still in ` +
      "flight, so what they measure is timing, not research quality";
    console.log(`  gave up waiting: ${running.length} still active`);
    break;
  }
  const recorded = kids.reduce((n, c) => n + readCount(c.vendorsRecorded), 0);
  console.log(`  waiting on ${running.length}/${kids.length} specialists · ${recorded} vendors`);
  await new Promise((r) => setTimeout(r, 15_000));
}

const tree = await getTraceTree(sessionId);
const raw = await listAllFindings(sessionId);

const agents: AgentFacts[] = [tree.root, ...tree.children]
  .filter((s): s is NonNullable<typeof s> => Boolean(s))
  .map((s) => ({
    id: s.id,
    label: s.label,
    role: s.role === "root" ? "root" : "specialist",
    model: s.model ?? undefined,
    status: s.status,
    steps: readCount(s.steps),
    toolCalls: readCount(s.toolCalls),
    failedActions: readCount(s.failedActions),
    refusedActions: readCount(s.refusedActions),
    // Searches performed, not calls requested: a call refused at the budget
    // cap never reached Tavily, and the A/B grader compares this number.
    searches: toolRuns(s, "web_search"),
    vendorsRecorded: readCount(s.vendorsRecorded),
    truncations: readCount(s.truncations),
    inputTokens: readCount(s.inputTokens),
    outputTokens: readCount(s.outputTokens),
    // Recomputed, not the stored figure: costs written before the cache
    // fix are ~1.9x high, and the grader compares this column head-to-head.
    costUsd: agentCost(s),
    durationMs: readCount(s.durationMs),
    // Approach A has no cross-session corpus: every plan researches from zero.
    corpusHits: 0,
  }));

const findings: Record<string, FindingFacts[]> = {};
for (const [category, list] of Object.entries(raw)) {
  findings[category] = list.map((f) => ({
    name: f.name,
    category: f.category,
    website: f.website,
    inquiryEmail: f.inquiryEmail,
    priceSignal: f.priceSignal,
    includes: f.includes,
    styleFit: f.styleFit,
    caveat: f.caveat,
    sourceUrl: f.sourceUrl,
    location: f.location ?? null,
    distanceNote: f.distanceNote ?? null,
    imageUrls: f.imageUrls ?? [],
    fromCorpus: false,
  }));
}

const run: RunResult = {
  system: "eve-vercel",
  systemVersion: "v18",
  briefId: brief.id,
  runId: sessionId,
  traceUrl: (await traceUrl(tree.langsmithTraceId).catch(() => null)) ?? undefined,
  startedAt: new Date(t0).toISOString(),
  wallClockMs: Date.now() - t0,
  status,
  incomplete,
  agents,
  findings,
};

const out = new URL(`../runs/eve-${brief.id}.json`, import.meta.url);
writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
console.log(
  `\nwrote ${out.pathname}\n  ${agents.length} agents · ` +
    `${Object.values(findings).reduce((n, l) => n + l.length, 0)} vendors · ` +
    `$${agents.reduce((n, a) => n + a.costUsd, 0).toFixed(2)} · ` +
    `${((Date.now() - t0) / 1000).toFixed(0)}s`,
);
if (incomplete) {
  console.log(`\nNOT A SCORE — ${incomplete}.`);
  console.log("Recorded in the file; grading it publishes the card unscored. Re-run before quoting it.");
}
console.log(`grade it with:  npm run grade -- runs/eve-${brief.id}.json`);
