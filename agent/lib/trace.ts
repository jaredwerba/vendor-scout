/**
 * Observability store — a compact, queryable trace of every session, written
 * by the observe hook (agent/hooks/observe.ts) after each durable stream event
 * and read by /observe. Lives in Upstash Redis via REST, beside the roster,
 * because eve's own state is per-session and /observe needs to see across
 * sessions. LangSmith (agent/instrumentation.ts) holds the deep, span-level
 * trace; this is the glanceable one the app itself can show.
 *
 * Keys: trace:index (zset, score = ms) · trace:session:<id> (JSON summary)
 *       trace:events:<id> (list, newest last, capped) · eval:<kind> (JSON)
 */

const URL_BASE = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
const TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_EVENTS = 400;

export const traceConfigured = () => Boolean(URL_BASE && TOKEN);

type Cmd = (string | number)[];

async function redis(commands: Cmd[]): Promise<unknown[]> {
  const res = await fetch(`${URL_BASE}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`trace store: redis ${res.status}`);
  const json = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  return json.map((r) => r.result ?? null);
}

export type TraceStatus = "active" | "waiting" | "completed" | "failed";

export interface TraceSummary {
  id: string;
  startedAt: string;
  updatedAt: string;
  title: string | null;
  status: TraceStatus;
  turns: number;
  steps: number;
  toolCalls: number;
  toolResults: number;
  failedActions: number;
  subagents: number;
  questions: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string | null;
  lastTool: string | null;
  lastEvent: string | null;
  tools: Record<string, number>;
}

export interface TraceEntry {
  t: string;
  type: string;
  seq?: number;
  tool?: string;
  name?: string;
  note?: string;
  ok?: boolean;
  tokens?: { in: number; out: number };
}

export interface EvalCaseResult {
  name: string;
  expected: string;
  got: string;
  ok: boolean;
  note?: string;
}

export interface EvalSummary {
  kind: string;
  name: string;
  ranAt: string;
  model: string | null;
  n: number;
  passed: number;
  score: number; // 0..1
  cases: EvalCaseResult[];
  langsmith?: { dataset?: string; experiment?: string; url?: string } | null;
  note?: string;
}

const key = (id: string) => `trace:session:${id}`;
const evKey = (id: string) => `trace:events:${id}`;

// Deltas arrive many times per second; the summary only needs boundaries.
const SKIP = new Set(["message.appended", "reasoning.appended", "reasoning.completed"]);

function fresh(id: string, now: string): TraceSummary {
  return {
    id, startedAt: now, updatedAt: now, title: null, status: "active",
    turns: 0, steps: 0, toolCalls: 0, toolResults: 0, failedActions: 0, subagents: 0, questions: 0,
    inputTokens: 0, outputTokens: 0, costUsd: 0, model: null, lastTool: null, lastEvent: null, tools: {},
  };
}

// The runtime action shapes are eve-owned; read them defensively so a
// protocol change degrades the trace instead of throwing inside a hook.
// biome-ignore lint/suspicious/noExplicitAny: protocol projection
type Any = any;
export function actionName(a: Any): string {
  return String(a?.toolName ?? a?.name ?? a?.tool?.name ?? a?.skill ?? a?.kind ?? "action");
}

function apply(s: TraceSummary, ev: { type: string; data?: Any }, now: string, inSubagent = false): TraceEntry | null {
  const d = ev.data ?? {};
  const seq = typeof d.sequence === "number" ? d.sequence : undefined;
  s.lastEvent = ev.type;
  switch (ev.type) {
    case "session.started": {
      s.status = "active";
      const m = d?.runtime?.model;
      s.model = typeof m === "string" ? m : (m?.id ?? m?.modelId ?? s.model ?? null);
      return { t: now, type: ev.type, note: d?.runtime?.eve ? `eve ${d.runtime.eve}` : undefined };
    }
    case "turn.started":
      s.turns += 1; s.status = "active";
      return { t: now, type: ev.type, seq, note: d.turnId };
    case "message.received":
      if (!s.title && typeof d.message === "string") s.title = d.message.slice(0, 90);
      return { t: now, type: ev.type, seq, note: typeof d.message === "string" ? d.message.slice(0, 120) : undefined };
    case "step.started":
      s.steps += 1;
      return { t: now, type: ev.type, seq, note: `step ${d.stepIndex ?? s.steps}` };
    case "step.completed": {
      const u = d.usage ?? {};
      const inTok = Number(u.inputTokens ?? 0), outTok = Number(u.outputTokens ?? 0);
      s.inputTokens += inTok; s.outputTokens += outTok; s.costUsd += Number(u.costUsd ?? 0);
      return { t: now, type: ev.type, seq, note: `finish: ${d.finishReason ?? "?"}`, tokens: { in: inTok, out: outTok } };
    }
    case "actions.requested": {
      const actions: Any[] = Array.isArray(d.actions) ? d.actions : [];
      let last: TraceEntry | null = null;
      for (const a of actions) {
        const name = actionName(a);
        s.toolCalls += 1; s.tools[name] = (s.tools[name] ?? 0) + 1; s.lastTool = name;
        if (name === "ask_question") s.questions += 1;
        last = { t: now, type: ev.type, seq, tool: name, note: inSubagent ? "inside specialist" : undefined };
      }
      return last ?? { t: now, type: ev.type, seq };
    }
    case "action.result": {
      const name = actionName(d.result);
      const ok = d.status !== "failed" && !d.error && !d?.result?.isError;
      s.toolResults += 1; if (!ok) s.failedActions += 1;
      return { t: now, type: ev.type, seq, tool: name, ok, note: ok ? undefined : String(d?.error?.message ?? "failed") };
    }
    case "input.requested":
      s.questions += Array.isArray(d.requests) ? d.requests.length : 1; s.status = "waiting";
      return { t: now, type: ev.type, seq, note: "waiting on the couple" };
    case "subagent.called":
      s.subagents += 1;
      return { t: now, type: ev.type, seq, name: d.name ?? d.toolName, note: d.childSessionId };
    case "subagent.started":
      return { t: now, type: ev.type, name: d.subagentName };
    case "subagent.completed":
      return { t: now, type: ev.type, name: d.subagentName, ok: true };
    case "subagent.event": {
      const inner = d.event;
      if (!inner || SKIP.has(inner.type)) return null;
      if (inner.type === "actions.requested" || inner.type === "action.result" || inner.type === "step.completed") {
        const e = apply(s, inner, now, true);
        return e ? { ...e, name: d.subagentName } : null;
      }
      return null;
    }
    case "message.completed":
      return { t: now, type: ev.type, seq, note: `finish: ${d.finishReason ?? "?"}` };
    case "turn.completed":
      return { t: now, type: ev.type, seq, ok: true };
    case "turn.cancelled":
      return { t: now, type: ev.type, seq, note: "cancelled" };
    case "step.failed":
    case "turn.failed":
    case "session.failed":
      s.status = "failed";
      return { t: now, type: ev.type, seq, ok: false, note: `${d.code ?? "error"}: ${String(d.message ?? "").slice(0, 160)}` };
    case "session.waiting":
      if (s.status !== "failed") s.status = "waiting";
      return { t: now, type: ev.type };
    case "session.completed":
      s.status = "completed";
      return { t: now, type: ev.type };
    case "compaction.requested":
    case "compaction.completed":
      return { t: now, type: ev.type, note: d.modelId };
    default:
      return null;
  }
}

const cache = new Map<string, TraceSummary>();

/** Called by the observe hook for every durable stream event. Never throws. */
export async function recordTraceEvent(sessionId: string, event: { type: string; data?: unknown }): Promise<void> {
  if (!traceConfigured() || !sessionId || SKIP.has(event.type)) return;
  try {
    const now = new Date().toISOString();
    let s = cache.get(sessionId);
    if (!s) {
      const [raw] = await redis([["GET", key(sessionId)]]);
      s = typeof raw === "string" && raw ? (JSON.parse(raw) as TraceSummary) : fresh(sessionId, now);
      cache.set(sessionId, s);
    }
    const entry = apply(s, event as { type: string; data?: unknown }, now);
    s.updatedAt = now;
    const cmds: Cmd[] = [
      ["SET", key(sessionId), JSON.stringify(s), "EX", TTL_SECONDS],
      ["ZADD", "trace:index", Date.now(), sessionId],
    ];
    if (entry) {
      cmds.push(
        ["RPUSH", evKey(sessionId), JSON.stringify(entry)],
        ["LTRIM", evKey(sessionId), -MAX_EVENTS, -1],
        ["EXPIRE", evKey(sessionId), TTL_SECONDS],
      );
    }
    await redis(cmds);
  } catch (error) {
    console.warn("[venus/trace] record failed", (error as Error)?.message ?? error);
  }
}

export async function listTraces(limit = 20): Promise<TraceSummary[]> {
  if (!traceConfigured()) return [];
  const [ids] = (await redis([["ZREVRANGE", "trace:index", 0, Math.max(0, limit - 1)]])) as [string[] | null];
  if (!ids || ids.length === 0) return [];
  const [raws] = (await redis([["MGET", ...ids.map(key)]])) as [Array<string | null>];
  return raws
    .map((r) => { try { return r ? (JSON.parse(r) as TraceSummary) : null; } catch { return null; } })
    .filter((s): s is TraceSummary => Boolean(s));
}

export async function getTrace(id: string): Promise<TraceSummary | null> {
  if (!traceConfigured()) return null;
  const [raw] = await redis([["GET", key(id)]]);
  return typeof raw === "string" && raw ? (JSON.parse(raw) as TraceSummary) : null;
}

export async function getTraceEvents(id: string, limit = MAX_EVENTS): Promise<TraceEntry[]> {
  if (!traceConfigured()) return [];
  const [raws] = (await redis([["LRANGE", evKey(id), -limit, -1]])) as [string[] | null];
  return (raws ?? []).map((r) => { try { return JSON.parse(r) as TraceEntry; } catch { return null; } }).filter((e): e is TraceEntry => Boolean(e));
}

export async function saveEvalSummary(summary: EvalSummary): Promise<void> {
  if (!traceConfigured()) throw new Error("trace store not configured (KV_REST_API_URL / KV_REST_API_TOKEN)");
  await redis([["SET", `eval:${summary.kind}`, JSON.stringify(summary)]]);
}

export async function getEvalSummary(kind: string): Promise<EvalSummary | null> {
  if (!traceConfigured()) return null;
  const [raw] = await redis([["GET", `eval:${kind}`]]);
  return typeof raw === "string" && raw ? (JSON.parse(raw) as EvalSummary) : null;
}
