/**
 * Fleet statistics across every session Venus has run.
 *
 * Three questions a demo cannot answer and a traced system can:
 *   - how reliable is a single step, and what does that compound to?
 *   - what does a run cost, including the tail?
 *   - is any of it getting better, run over run?
 *
 * Shared by `npm run report` and by /observe so the console and the CLI can
 * never disagree about the numbers.
 */

import { getTraceTree, listTraces, readCount, type TraceSummary } from "./trace";

export interface RunFacts {
  id: string;
  agents: number;
  steps: number;
  toolCalls: number;
  failedActions: number;
  truncations: number;
  costUsd: number;
  durationMs: number;
  startedAt: string;
}

export interface FleetStats {
  runs: RunFacts[];
  sessions: number;
  agentSessions: number;
  steps: number;
  toolCalls: number;
  failedActions: number;
  truncations: number;
  totalCostUsd: number;
  /** Probability a single tool call succeeds, measured across every agent. */
  actionSuccess: number;
  /** actionSuccess ** n, for representative workflow lengths. */
  compounding: { steps: number; probability: number }[];
  cost: { median: number; p90: number; max: number; ratio: number; n: number } | null;
  /** Median steps for a run that actually fanned out specialists. */
  medianRealRun: { steps: number; agents: number } | null;
}

const WORKFLOW_LENGTHS = [1, 5, 10, 20, 40];

export async function fleetStats(limit = 100): Promise<FleetStats> {
  const roots = await listTraces(limit);
  const trees = await Promise.all(roots.map((r) => getTraceTree(r.id).catch(() => null)));

  const runs: RunFacts[] = roots.map((r, i) => {
    const all: TraceSummary[] = [r, ...(trees[i]?.children ?? [])];
    return {
      id: r.id,
      agents: all.length,
      steps: all.reduce((n, s) => n + readCount(s.steps), 0),
      toolCalls: all.reduce((n, s) => n + readCount(s.toolCalls), 0),
      failedActions: all.reduce((n, s) => n + readCount(s.failedActions), 0),
      truncations: all.reduce((n, s) => n + readCount(s.truncations), 0),
      costUsd: all.reduce((n, s) => n + (Number(s.costUsd) || 0), 0),
      durationMs: Math.max(0, ...all.map((s) => readCount(s.durationMs))),
      startedAt: r.startedAt,
    };
  });

  const sum = (pick: (r: RunFacts) => number) => runs.reduce((n, r) => n + pick(r), 0);
  const toolCalls = sum((r) => r.toolCalls);
  const failedActions = sum((r) => r.failedActions);
  const actionSuccess = toolCalls > 0 ? 1 - failedActions / toolCalls : 1;

  const costed = runs.filter((r) => r.costUsd > 0).sort((a, b) => a.costUsd - b.costUsd);
  const quantile = (q: number) =>
    costed.length === 0 ? 0 : costed[Math.min(costed.length - 1, Math.floor(q * costed.length))].costUsd;
  const median = quantile(0.5);
  const max = costed.length ? costed[costed.length - 1].costUsd : 0;

  // Only runs that actually fanned out specialists represent the real
  // workload; a one-turn greeting is not what the architecture is for.
  const real = runs.filter((r) => r.agents > 1).sort((a, b) => a.steps - b.steps);
  const mid = real[Math.floor(real.length / 2)];

  return {
    runs,
    sessions: runs.length,
    agentSessions: sum((r) => r.agents),
    steps: sum((r) => r.steps),
    toolCalls,
    failedActions,
    truncations: sum((r) => r.truncations),
    totalCostUsd: sum((r) => r.costUsd),
    actionSuccess,
    compounding: WORKFLOW_LENGTHS.map((steps) => ({
      steps,
      probability: actionSuccess ** steps,
    })),
    cost: costed.length
      ? { median, p90: quantile(0.9), max, ratio: median > 0 ? max / median : 0, n: costed.length }
      : null,
    medianRealRun: mid ? { steps: mid.steps, agents: mid.agents } : null,
  };
}
