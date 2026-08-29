/**
 * Observability store — a compact, queryable trace of every session in the
 * agent tree, written by the observe hook (agent/hooks/observe.ts) after each
 * durable stream event and read by the app's live rail and by /observe.
 *
 * Lives in Upstash Redis via REST, beside the roster, because eve's own state
 * is per-session and the console needs to see across sessions. LangSmith
 * (agent/instrumentation.ts) holds the deep, span-level trace; this is the
 * glanceable one the app itself can show, and the only one that survives
 * without a LangSmith login.
 *
 * Two rules this store enforces:
 *   1. The tree is explicit. A delegated specialist writes its own summary
 *      and is linked to its root, so "what is each agent doing right now"
 *      is a single read, not a reconstruction.
 *   2. Nothing the couple typed is ever stored. /observe is public; message
 *      text, vendor emails and search queries from the main conversation stay
 *      out of KV entirely. What is stored is shape: types, names, counts,
 *      timings, tokens, cost.
 *
 * Keys: trace:index (zset of ROOT ids, score = ms)
 *       trace:session:<id> (JSON TraceSummary, roots and children)
 *       trace:events:<id>  (list, newest last, capped)
 *       trace:children:<rootId> (list of child session ids, call order)
 *       trace:call:<callId> (callId -> child session id)
 *       trace:langsmith:<id> (JSON {traceId})
 *       eval:<kind> (JSON EvalSummary)
 */

import { actionName, categoryFromBrief, isSubagentAction, readUsage } from "./actions";
import { costFor } from "./pricing";

const URL_BASE = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
const TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_EVENTS = 600;

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
export type TraceRole = "root" | "specialist";

export interface TraceSummary {
  id: string;
  role: TraceRole;
  /** "Venus" for the root; the research category for a specialist. */
  label: string;
  /** The declared subagent's tool name (e.g. "scout"), when this is a child. */
  agentName: string | null;
  rootSessionId: string;
  parentSessionId: string | null;
  callId: string | null;
  startedAt: string;
  updatedAt: string;
  durationMs: number;
  /** Redacted: never the couple's words. Budget line for the root, else null. */
  title: string | null;
  status: TraceStatus;
  turns: number;
  steps: number;
  toolCalls: number;
  toolResults: number;
  failedActions: number;
  subagents: number;
  questions: number;
  /** record_vendor calls that succeeded — partial progress, visible live. */
  vendorsRecorded: number;
  /** Steps that hit the output cap: findings may be missing, never silent. */
  truncations: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  model: string | null;
  lastTool: string | null;
  lastEvent: string | null;
  tools: Record<string, number>;
}

export interface TraceEntry {
  /** Event time from eve's durable stamp (meta.at), not hook wall-clock. */
  t: string;
  /** Milliseconds since the previous recorded entry in this session. */
  dt?: number;
  type: string;
  seq?: number;
  tool?: string;
  name?: string;
  note?: string;
  ok?: boolean;
  tokens?: { in: number; out: number };
  costUsd?: number;
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
  judgeModel?: string | null;
  n: number;
  passed: number;
  score: number; // 0..1
  cases: EvalCaseResult[];
  langsmith?: { dataset?: string; experiment?: string; url?: string } | null;
  note?: string;
}

const key = (id: string) => `trace:session:${id}`;
const evKey = (id: string) => `trace:events:${id}`;
const childrenKey = (rootId: string) => `trace:children:${rootId}`;

// Deltas arrive many times per second; the summary only needs boundaries.
const SKIP = new Set(["message.appended", "reasoning.appended", "reasoning.completed"]);

export interface SessionLineage {
  callId?: string;
  rootSessionId?: string;
  sessionId?: string;
}

function fresh(id: string, now: string, parent?: SessionLineage | null): TraceSummary {
  const isChild = Boolean(parent?.sessionId);
  return {
    id,
    role: isChild ? "specialist" : "root",
    label: isChild ? "specialist" : "Venus",
    agentName: null,
    rootSessionId: parent?.rootSessionId ?? parent?.sessionId ?? id,
    parentSessionId: parent?.sessionId ?? null,
    callId: parent?.callId ?? null,
    startedAt: now,
    updatedAt: now,
    durationMs: 0,
    title: null,
    status: "active",
    turns: 0, steps: 0, toolCalls: 0, toolResults: 0, failedActions: 0, subagents: 0,
    questions: 0, vendorsRecorded: 0, truncations: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0,
    model: null, lastTool: null, lastEvent: null, tools: {},
  };
}

// biome-ignore lint/suspicious/noExplicitAny: eve protocol projection
type Any = any;

/**
 * What may be written about a tool call. Vendor research is the product's
 * visible work and safe to show; anything carrying the couple's words or a
 * vendor's address is reduced to a shape.
 */
function describeAction(a: Any, role: TraceRole): string | undefined {
  const name = actionName(a);
  const input = (a?.input ?? {}) as Record<string, unknown>;
  if (name === "web_search" && role === "specialist" && typeof input.query === "string") {
    // A specialist's query is vendor research, not private: show it.
    const extra = [input.time_range, input.topic].filter(Boolean).join(" · ");
    return `"${input.query.slice(0, 90)}"${extra ? ` · ${extra}` : ""}`;
  }
  if (name === "web_search") {
    return typeof input.query === "string" ? `query · ${input.query.length} chars` : undefined;
  }
  if (name === "record_vendor") {
    return typeof input.name === "string" ? String(input.name).slice(0, 60) : undefined;
  }
  if (name === "send_outreach") return "vendor email (recipient redacted)";
  if (isSubagentAction(a)) return categoryFromBrief(input.message) ?? undefined;
  if (name === "ask_question") return "tappable options";
  return undefined;
}

function apply(s: TraceSummary, ev: { type: string; data?: Any }, now: string): TraceEntry | null {
  const d = ev.data ?? {};
  const seq = typeof d.sequence === "number" ? d.sequence : undefined;
  s.lastEvent = ev.type;
  switch (ev.type) {
    case "session.started": {
      s.status = "active";
      // RuntimeIdentity.modelId is the authoritative field; the older
      // `runtime.model` shape is kept as a fallback. Getting this wrong is
      // invisible: the trace still records tokens, but every cost is $0.
      const m = d?.runtime?.modelId ?? d?.runtime?.model;
      s.model = typeof m === "string" ? m : (m?.id ?? m?.modelId ?? s.model ?? null);
      if (d?.invocation?.kind === "subagent") {
        s.role = "specialist";
        s.agentName = String(d.invocation.name ?? "subagent");
        s.parentSessionId = s.parentSessionId ?? (String(d.invocation.parentSessionId ?? "") || null);
        s.callId = s.callId ?? (String(d.invocation.parentCallId ?? "") || null);
        if (s.label === "specialist") s.label = s.agentName;
      }
      return { t: now, type: ev.type, note: d?.runtime?.eve ? `eve ${d.runtime.eve}` : undefined };
    }
    case "turn.started":
      s.turns += 1; s.status = "active";
      return { t: now, type: ev.type, seq };
    case "message.received": {
      // A specialist's inbound message is the research brief: its first line
      // declares the category and becomes the lane label. The root's inbound
      // message is the couple talking — never stored, only measured.
      const text = typeof d.message === "string" ? d.message : "";
      if (s.role === "specialist") {
        const category = categoryFromBrief(text);
        if (category) s.label = category;
        return { t: now, type: ev.type, seq, note: category ? `brief · ${category}` : "brief received" };
      }
      if (!s.title) {
        const budget = text.match(/\$[\d,]+/);
        if (budget) s.title = `Budget ${budget[0]}`;
      }
      return { t: now, type: ev.type, seq, note: `${text.length} chars` };
    }
    case "step.started":
      s.steps += 1;
      return { t: now, type: ev.type, seq, note: `step ${d.stepIndex ?? s.steps}` };
    case "step.completed": {
      const u = readUsage(d.usage);
      s.inputTokens += u.inputTokens;
      s.outputTokens += u.outputTokens;
      s.cacheReadTokens += u.cacheReadTokens;
      const cost = Number(d.usage?.costUsd ?? 0) || costFor(s.model, u);
      s.costUsd += cost;
      const truncated = d.finishReason === "length";
      if (truncated) s.truncations += 1;
      return {
        t: now, type: ev.type, seq,
        note: truncated ? "TRUNCATED (hit the output cap)" : `finish: ${d.finishReason ?? "?"}`,
        ok: !truncated,
        tokens: { in: u.inputTokens, out: u.outputTokens },
        costUsd: cost,
      };
    }
    case "actions.requested": {
      const actions: Any[] = Array.isArray(d.actions) ? d.actions : [];
      let last: TraceEntry | null = null;
      for (const a of actions) {
        const name = actionName(a);
        s.toolCalls += 1; s.tools[name] = (s.tools[name] ?? 0) + 1; s.lastTool = name;
        if (name === "ask_question") s.questions += 1;
        // `subagent.called` is not delivered on the parent's durable stream in
        // eve 0.24.4 (only `subagent.completed` is), so count the delegation
        // where it IS visible: the request itself.
        if (isSubagentAction(a)) {
          s.subagents += 1;
          const category = categoryFromBrief((a?.input ?? {}).message);
          if (category && a?.callId) pendingCallCategories.set(String(a.callId), category);
        }
        last = { t: now, type: ev.type, seq, tool: name, note: describeAction(a, s.role) };
      }
      return last ?? { t: now, type: ev.type, seq };
    }
    case "action.result": {
      const name = actionName(d.result);
      const ok = d.status !== "failed" && !d.error && !d?.result?.isError;
      s.toolResults += 1;
      if (!ok) s.failedActions += 1;
      if (ok && name === "record_vendor") s.vendorsRecorded += 1;
      // A specialist's result carries the child's whole token bill.
      const usage = d?.result?.usage ? readUsage(d.result.usage) : null;
      return {
        t: now, type: ev.type, seq, tool: name, ok,
        note: ok
          ? (d.status === "rejected" ? "declined at the approval gate" : undefined)
          : String(d?.error?.message ?? "failed").slice(0, 140),
        tokens: usage ? { in: usage.inputTokens, out: usage.outputTokens } : undefined,
      };
    }
    case "input.requested":
      s.questions += Array.isArray(d.requests) ? d.requests.length : 1;
      s.status = "waiting";
      return { t: now, type: ev.type, seq, note: "waiting on the couple" };
    case "subagent.called":
      // Counted at actions.requested; this only enriches the log when eve
      // does deliver it.
      return {
        t: now, type: ev.type, seq,
        name: String(d.subagentName ?? d.name ?? "specialist"),
        note: d.childSessionId ? `child ${String(d.childSessionId).slice(-8)}` : undefined,
      };
    case "subagent.completed":
      return { t: now, type: ev.type, name: d.subagentName, ok: true };
    case "message.completed": {
      const truncated = d.finishReason === "length";
      if (truncated) s.truncations += 1;
      return {
        t: now, type: ev.type, seq, ok: !truncated,
        note: truncated ? "TRUNCATED reply" : `finish: ${d.finishReason ?? "?"}`,
      };
    }
    case "turn.completed":
      return { t: now, type: ev.type, seq, ok: true };
    case "turn.cancelled":
      s.status = "completed";
      return { t: now, type: ev.type, seq, note: "cancelled" };
    case "step.failed":
    case "turn.failed":
    case "session.failed":
      s.status = "failed";
      return {
        t: now, type: ev.type, seq, ok: false,
        note: `${d.code ?? "error"}: ${String(d.message ?? "").slice(0, 160)}`,
      };
    case "session.waiting":
      if (s.status !== "failed") s.status = "waiting";
      return { t: now, type: ev.type };
    case "session.completed":
      if (s.status !== "failed") s.status = "completed";
      return { t: now, type: ev.type };
    case "compaction.requested":
    case "compaction.completed":
      return { t: now, type: ev.type, note: d.modelId };
    default:
      return null;
  }
}

const cache = new Map<string, TraceSummary>();
const lastAt = new Map<string, number>();
/**
 * callId -> research category, learned when the parent requests a delegation.
 * The child never sees a clean `CATEGORY:` first line reliably, so this is how
 * a specialist lane gets its real name instead of "specialist".
 */
const pendingCallCategories = new Map<string, string>();

/** Called by the observe hook for every durable stream event. Never throws. */
export async function recordTraceEvent(
  sessionId: string,
  event: { type: string; data?: unknown; meta?: { at?: string } },
  lineage?: SessionLineage | null,
): Promise<void> {
  if (!traceConfigured() || !sessionId || SKIP.has(event.type)) return;
  try {
    // eve stamps meta.at when it writes the event to the durable stream, so
    // this is the real event time even when the hook runs late or on replay.
    const at = event.meta?.at ?? new Date().toISOString();
    let s = cache.get(sessionId);
    if (!s) {
      const [raw] = await redis([["GET", key(sessionId)]]);
      s = typeof raw === "string" && raw ? (JSON.parse(raw) as TraceSummary) : fresh(sessionId, at, lineage);
      cache.set(sessionId, s);
    }
    if (lineage?.sessionId && !s.parentSessionId) {
      s.parentSessionId = lineage.sessionId;
      s.rootSessionId = lineage.rootSessionId ?? lineage.sessionId;
      s.callId = lineage.callId ?? s.callId;
      s.role = "specialist";
    }
    const entry = apply(s, event as { type: string; data?: unknown }, at);
    s.updatedAt = at;
    s.durationMs = Math.max(0, Date.parse(at) - Date.parse(s.startedAt));

    const cmds: Cmd[] = [["SET", key(sessionId), JSON.stringify(s), "EX", TTL_SECONDS]];
    for (const [callId, category] of pendingCallCategories) {
      cmds.push(["SET", `trace:callcat:${callId}`, category, "EX", TTL_SECONDS]);
    }
    pendingCallCategories.clear();
    if (s.role === "root") {
      cmds.push(["ZADD", "trace:index", Date.parse(at) || Date.now(), sessionId]);
    } else if (event.type === "session.started") {
      // Link the child into its root's tree exactly once.
      cmds.push(
        ["RPUSH", childrenKey(s.rootSessionId), sessionId],
        ["EXPIRE", childrenKey(s.rootSessionId), TTL_SECONDS],
      );
      if (s.callId) cmds.push(["SET", `trace:call:${s.callId}`, sessionId, "EX", TTL_SECONDS]);
    }
    if (entry) {
      const prev = lastAt.get(sessionId);
      const ms = Date.parse(at);
      if (prev && Number.isFinite(ms)) entry.dt = Math.max(0, ms - prev);
      if (Number.isFinite(ms)) lastAt.set(sessionId, ms);
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

function parse<T>(raw: unknown): T | null {
  try {
    return typeof raw === "string" && raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Root sessions, newest first. Children are reached through the tree. */
export async function listTraces(limit = 20): Promise<TraceSummary[]> {
  if (!traceConfigured()) return [];
  const [ids] = (await redis([["ZREVRANGE", "trace:index", 0, Math.max(0, limit - 1)]])) as [string[] | null];
  if (!ids || ids.length === 0) return [];
  const [raws] = (await redis([["MGET", ...ids.map(key)]])) as [Array<string | null>];
  return raws.map((r) => parse<TraceSummary>(r)).filter((s): s is TraceSummary => Boolean(s));
}

export async function getTrace(id: string): Promise<TraceSummary | null> {
  if (!traceConfigured()) return null;
  const [raw] = await redis([["GET", key(id)]]);
  return parse<TraceSummary>(raw);
}

export async function getTraceEvents(id: string, limit = MAX_EVENTS): Promise<TraceEntry[]> {
  if (!traceConfigured()) return [];
  const [raws] = (await redis([["LRANGE", evKey(id), -limit, -1]])) as [string[] | null];
  return (raws ?? []).map((r) => parse<TraceEntry>(r)).filter((e): e is TraceEntry => Boolean(e));
}

/**
 * How long a specialist may go silent before it is treated as wedged.
 *
 * Sentinel carries a stall guard for a failure it actually hit: provider
 * streams left in CLOSE_WAIT never raised, three hung workers held the whole
 * fan-out hostage for 60+ minutes, and the audit produced nothing. Its guard
 * wraps the thread pool, because Sentinel owns that loop.
 *
 * eve owns the loop here, so the same intent is enforced at the read instead:
 * a specialist still marked active whose last event is older than this is
 * reported as stalled, and the planner proceeds with what it has. A healthy
 * scout emits an event every few seconds, so five minutes of silence is
 * wedged rather than slow.
 */
export const STALL_AFTER_MS = Number(process.env.SCOUT_STALL_MS ?? 5 * 60 * 1000);

export function isStalled(summary: TraceSummary, now = Date.now()): boolean {
  if (summary.status !== "active") return false;
  const last = Date.parse(summary.updatedAt);
  return Number.isFinite(last) && now - last > STALL_AFTER_MS;
}

const isGenericLabel = (label: string) =>
  !label || label === "specialist" || label === "scout" || label === "subagent";

export interface TraceTree {
  root: TraceSummary | null;
  children: TraceSummary[];
  langsmithTraceId: string | null;
}

/** The whole agent tree for one root session: Venus plus every specialist. */
/** Older summaries predate some counters; read them as 0 rather than NaN. */
export function readCount(n: unknown): number {
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}

export async function getTraceTree(rootId: string): Promise<TraceTree> {
  if (!traceConfigured()) return { root: null, children: [], langsmithTraceId: null };
  const [rootRaw, childIds, lsRaw] = (await redis([
    ["GET", key(rootId)],
    ["LRANGE", childrenKey(rootId), 0, -1],
    ["GET", `trace:langsmith:${rootId}`],
  ])) as [string | null, string[] | null, string | null];
  const ids = childIds ?? [];
  let children: TraceSummary[] = [];
  if (ids.length > 0) {
    const [raws] = (await redis([["MGET", ...ids.map(key)]])) as [Array<string | null>];
    children = raws.map((r) => parse<TraceSummary>(r)).filter((s): s is TraceSummary => Boolean(s));
  }
  // Name each specialist lane from the category its delegation declared.
  const unnamed = children.filter((c) => c.callId && isGenericLabel(c.label));
  if (unnamed.length > 0) {
    const cats = (await redis(
      unnamed.map((c) => ["GET", `trace:callcat:${c.callId}`]),
    )) as Array<string | null>;
    unnamed.forEach((c, i) => {
      if (typeof cats[i] === "string" && cats[i]) c.label = cats[i] as string;
    });
  }

  const ls = parse<{ traceId?: string }>(lsRaw);
  return { root: parse<TraceSummary>(rootRaw), children, langsmithTraceId: ls?.traceId ?? null };
}

/** Written by the OTel exporter on the first span of a session. */
export async function saveLangSmithTraceId(sessionId: string, traceId: string): Promise<void> {
  if (!traceConfigured() || !sessionId || !traceId) return;
  await redis([["SET", `trace:langsmith:${sessionId}`, JSON.stringify({ traceId }), "EX", TTL_SECONDS]]);
}

export async function saveEvalSummary(summary: EvalSummary): Promise<void> {
  if (!traceConfigured()) throw new Error("trace store not configured (KV_REST_API_URL / KV_REST_API_TOKEN)");
  await redis([
    ["SET", `eval:${summary.kind}`, JSON.stringify(summary)],
    ["SADD", "eval:kinds", summary.kind],
  ]);
}

export async function getEvalSummary(kind: string): Promise<EvalSummary | null> {
  if (!traceConfigured()) return null;
  const [raw] = await redis([["GET", `eval:${kind}`]]);
  return parse<EvalSummary>(raw);
}

export async function listEvalSummaries(): Promise<EvalSummary[]> {
  if (!traceConfigured()) return [];
  const [kinds] = (await redis([["SMEMBERS", "eval:kinds"]])) as [string[] | null];
  const names = kinds && kinds.length > 0 ? kinds : ["replies", "suite"];
  const [raws] = (await redis([["MGET", ...names.map((k) => `eval:${k}`)]])) as [Array<string | null>];
  return raws
    .map((r) => parse<EvalSummary>(r))
    .filter((e): e is EvalSummary => Boolean(e))
    .sort((a, b) => (a.kind < b.kind ? -1 : 1));
}
