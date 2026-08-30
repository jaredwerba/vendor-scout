/**
 * The contract both implementations emit, so one grader scores both.
 *
 * The comparison in docs/ is only worth anything if Approach A (eve on
 * Vercel) and Approach B (LangGraph on Nebius) are graded by identical code
 * against the identical fixed briefs. Two graders that "do the same thing"
 * is how benchmark comparisons quietly become marketing.
 *
 * So: every system under test runs a brief from evals/data/briefs.json and
 * writes a RunResult (evals/harness/run-result.schema.json). scripts/grade.ts
 * is the only thing that turns one into a score, and it cannot see which
 * system produced it beyond the `system` label it prints.
 */

export interface AgentFacts {
  id?: string;
  /** "Venus" for the orchestrator; the research category for a specialist. */
  label: string;
  role: "root" | "specialist";
  model?: string;
  status?: string;
  steps: number;
  toolCalls: number;
  failedActions?: number;
  /** Guard refusals: the tool worked and declined the input on purpose. */
  refusedActions?: number;
  searches?: number;
  vendorsRecorded?: number;
  truncations?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  durationMs?: number;
  /** Vendors reused from a cross-session corpus rather than re-researched. */
  corpusHits?: number;
}

export interface FindingFacts {
  name: string;
  category: string;
  website?: string | null;
  inquiryEmail?: string | null;
  priceSignal?: string | null;
  includes?: string | null;
  styleFit?: string | null;
  caveat?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
  distanceNote?: string | null;
  imageUrls?: string[];
  fromCorpus?: boolean;
}

export interface RunResult {
  system: string;
  systemVersion?: string;
  briefId: string;
  runId?: string;
  traceUrl?: string;
  startedAt: string;
  wallClockMs: number;
  status?: "completed" | "waiting" | "failed" | "timeout";
  /**
   * Why this run must not be turned into a score, or null/absent if it settled.
   *
   * `waiting` is the healthy status of a planner parked while its specialists
   * work, so status alone cannot say whether the fan-out ever finished. Only
   * the collector that waited knows, and a run read mid-search grades timing
   * rather than research — few checks exist and most of them fail. The grader
   * carries this into EvalSummary.incomplete so the card publishes unscored.
   */
  incomplete?: string | null;
  agents: AgentFacts[];
  findings: Record<string, FindingFacts[]>;
}

export function totalCost(run: RunResult): number {
  return run.agents.reduce((n, a) => n + (Number(a.costUsd) || 0), 0);
}

export function totalVendors(run: RunResult): number {
  return Object.values(run.findings).reduce((n, list) => n + list.length, 0);
}

export function specialists(run: RunResult): AgentFacts[] {
  return run.agents.filter((a) => a.role === "specialist");
}
