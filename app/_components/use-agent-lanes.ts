"use client";

import { Client, isCurrentTurnBoundaryEvent } from "eve/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TraceEntry, TraceSummary } from "@/agent/lib/trace";
import type { StackEvent } from "./agent-stack";

/**
 * One lane per agent in the tree — Venus, plus every specialist she delegates
 * to — with the live event stream of each.
 *
 * eve's parent stream deliberately carries only control-plane events for a
 * delegation: `subagent.called` (with the child's session id), then the final
 * `action.result`. Nothing a child does in between reaches the parent, which
 * is why "what is each agent doing right now" was previously unanswerable
 * from the browser. So we do what eve's own dev TUI does: read the child
 * session id off `subagent.called` and attach to `GET /eve/v1/session/:id/stream`
 * directly, one connection per specialist.
 *
 * Two sources, because neither alone is complete:
 *   - the live streams, which are rich but only exist while the tab is open;
 *   - the KV trace tree (/api/observe/session/:id), which survives reloads and
 *     carries counters the stream does not compute (vendors recorded, cost).
 * A lane merges both and prefers whichever is authoritative for each field.
 */

const MAX_ATTACHED = 5;
const POLL_LIVE_MS = 6000;
const POLL_IDLE_MS = 30_000;

export type LaneStatus = "pending" | "live" | "done" | "failed";

export interface Lane {
  id: string;
  role: "root" | "specialist";
  /** "Venus" for the root; the research category for a specialist. */
  label: string;
  agentName: string | null;
  callId: string | null;
  /** Live stream events (empty for a child after a reload). */
  events: StackEvent[];
  /** Persisted, redacted log from KV (empty until the first poll lands). */
  entries: TraceEntry[];
  summary: TraceSummary | null;
  status: LaneStatus;
  attached: boolean;
}

interface TreeResponse {
  configured: boolean;
  root: TraceSummary | null;
  children: TraceSummary[];
  events: Record<string, TraceEntry[]>;
  research: Record<string, number>;
  langsmith: { traceId: string | null; url: string | null };
}

interface Delegation {
  callId: string;
  childSessionId: string;
  name: string;
}

// biome-ignore lint/suspicious/noExplicitAny: eve protocol projection
type Any = any;

/** Delegations announced by the parent stream, in call order. */
function readDelegations(events: readonly StackEvent[]): Delegation[] {
  const out: Delegation[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.type !== "subagent.called") continue;
    const d = (ev.data ?? {}) as Any;
    const childSessionId = String(d.childSessionId ?? "");
    if (!childSessionId || seen.has(childSessionId)) continue;
    seen.add(childSessionId);
    out.push({
      callId: String(d.callId ?? ""),
      childSessionId,
      name: String(d.subagentName ?? d.name ?? "specialist"),
    });
  }
  return out;
}

/** Call ids the parent has already collected a result for. */
function readSettledCalls(events: readonly StackEvent[]): Set<string> {
  const settled = new Set<string>();
  for (const ev of events) {
    const d = (ev.data ?? {}) as Any;
    if (ev.type === "action.result" && d?.result?.callId) settled.add(String(d.result.callId));
    if (ev.type === "subagent.completed" && d?.callId) settled.add(String(d.callId));
  }
  return settled;
}

/** The first line of a specialist's brief is `CATEGORY: <name>`. */
function laneLabel(name: string, summary: TraceSummary | null, events: StackEvent[]): string {
  if (summary?.label && summary.label !== "specialist") return summary.label;
  for (const ev of events) {
    if (ev.type !== "message.received") continue;
    const text = (ev.data as Any)?.message;
    if (typeof text !== "string") continue;
    const m = text.split("\n", 1)[0]?.match(/^\s*CATEGORY\s*:\s*(.+?)\s*$/i);
    if (m) return m[1].toLowerCase();
  }
  return name;
}

export interface UseAgentLanesOptions {
  /** The parent stream, when the caller already owns it (the chat does). */
  readonly rootEvents?: readonly StackEvent[];
  readonly rootSessionId: string | null | undefined;
  /** useEveAgent status — drives poll cadence and the root lane's state. */
  readonly status: string;
  /**
   * Attach to the root session's own stream too, and read finished children
   * back from index 0. The console does this (it owns no agent); the chat
   * does not (useEveAgent already holds the parent stream, and finished
   * children are covered by the KV log).
   */
  readonly attachAll?: boolean;
}

export interface AgentLanes {
  lanes: Lane[];
  langsmithUrl: string | null;
  research: Record<string, number>;
  /** True while any specialist stream is attached. */
  attachedCount: number;
  refresh: () => void;
}

export function useAgentLanes({
  rootEvents: providedRootEvents,
  rootSessionId,
  status,
  attachAll = false,
}: UseAgentLanesOptions): AgentLanes {
  const [childEvents, setChildEvents] = useState<Record<string, StackEvent[]>>({});
  const [attached, setAttached] = useState<Record<string, boolean>>({});
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [nonce, setNonce] = useState(0);
  const abortsRef = useRef(new Map<string, AbortController>());
  // Sessions already streamed to completion. This must outlive the effect:
  // the tree poll changes `tree.children` every few seconds, so a per-run Set
  // would re-attach every finished specialist on every poll.
  const doneRef = useRef(new Set<string>());

  // The parent stream: owned by the caller in the chat, attached here in the
  // console. Either way, everything downstream reads one array.
  const rootEvents = useMemo<readonly StackEvent[]>(
    () => providedRootEvents ?? (rootSessionId ? (childEvents[rootSessionId] ?? []) : []),
    [providedRootEvents, rootSessionId, childEvents],
  );
  const isLive =
    status === "streaming" || status === "submitted" || tree?.root?.status === "active";

  const delegations = useMemo(() => readDelegations(rootEvents), [rootEvents.length]);
  const settledCalls = useMemo(() => readSettledCalls(rootEvents), [rootEvents.length]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // --- The KV tree: survives reloads, carries what the stream cannot compute.
  useEffect(() => {
    if (!rootSessionId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/observe/session/${encodeURIComponent(rootSessionId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as TreeResponse;
        if (!cancelled && body.configured) setTree(body);
      } catch {
        // Observability must never break the app it observes.
      }
    };
    void load();
    const id = window.setInterval(load, isLive ? POLL_LIVE_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [rootSessionId, isLive, nonce]);

  // --- Live attach, one connection per agent, capped.
  useEffect(() => {
    const aborts = abortsRef.current;
    const done = doneRef.current;

    const attach = (sessionId: string) => {
      if (!sessionId || aborts.has(sessionId) || done.has(sessionId)) return;
      if (aborts.size >= MAX_ATTACHED) return;
      const controller = new AbortController();
      aborts.set(sessionId, controller);
      setAttached((a) => ({ ...a, [sessionId]: true }));

      void (async () => {
        try {
          // Same origin: the browser is already authorized for the chat routes.
          // startIndex 0 replays the whole durable stream, so attaching late
          // still yields the full picture rather than only what happens next.
          const session = new Client({ host: "" }).session({ sessionId, streamIndex: 0 });
          for await (const event of session.stream({ startIndex: 0, signal: controller.signal })) {
            setChildEvents((prev) => ({
              ...prev,
              [sessionId]: [...(prev[sessionId] ?? []), event as StackEvent],
            }));
            if (isCurrentTurnBoundaryEvent(event)) break;
          }
        } catch {
          // A dropped stream is not an app failure; the KV tree still reports
          // that lane's progress on the next poll.
        } finally {
          done.add(sessionId);
          aborts.delete(sessionId);
          setAttached((a) => ({ ...a, [sessionId]: false }));
        }
      })();
    };

    if (attachAll && rootSessionId) attach(rootSessionId);

    // eve 0.24.4 does not deliver `subagent.called` on the parent's durable
    // stream, so the child session ids mostly arrive through the trace tree
    // (each child writes its own summary, linked by ctx.session.parent).
    // Both sources are used: whichever names a child first wins.
    for (const d of delegations) {
      if (!attachAll && d.callId && settledCalls.has(d.callId)) continue;
      attach(d.childSessionId);
    }
    for (const c of tree?.children ?? []) {
      if (!attachAll && c.status !== "active") continue;
      attach(c.id);
    }
  }, [delegations, settledCalls, attachAll, rootSessionId, tree?.children]);

  // Close every attached stream when the rail unmounts.
  useEffect(() => {
    const aborts = abortsRef.current;
    return () => {
      for (const c of aborts.values()) c.abort();
      aborts.clear();
    };
  }, []);

  const lanes = useMemo<Lane[]>(() => {
    const rootSummary = tree?.root ?? null;
    const rootLane: Lane = {
      id: rootSessionId ?? "root",
      role: "root",
      label: "Venus",
      agentName: null,
      callId: null,
      events: rootEvents as StackEvent[],
      entries: (rootSessionId && tree?.events?.[rootSessionId]) || [],
      summary: rootSummary,
      status: isLive ? "live" : rootSummary?.status === "failed" ? "failed" : "done",
      attached: isLive,
    };

    const byId = new Map<string, TraceSummary>();
    for (const c of tree?.children ?? []) byId.set(c.id, c);

    // Delegations the parent announced, plus any child KV knows about that
    // this browser never saw (a reload mid-run).
    const ids = new Set<string>([...delegations.map((d) => d.childSessionId), ...byId.keys()]);
    const order = new Map<string, number>();
    delegations.forEach((d, i) => order.set(d.childSessionId, i));

    const children: Lane[] = Array.from(ids).map((id) => {
      const d = delegations.find((x) => x.childSessionId === id);
      const summary = byId.get(id) ?? null;
      const events = childEvents[id] ?? [];
      const settled = Boolean(d?.callId && settledCalls.has(d.callId));
      const failed = summary?.status === "failed";
      return {
        id,
        role: "specialist",
        label: laneLabel(d?.name ?? summary?.agentName ?? "specialist", summary, events),
        agentName: summary?.agentName ?? d?.name ?? null,
        callId: d?.callId ?? summary?.callId ?? null,
        events,
        entries: tree?.events?.[id] ?? [],
        summary,
        status: failed ? "failed" : settled || summary?.status === "completed" ? "done"
          : events.length > 0 || summary ? "live" : "pending",
        attached: Boolean(attached[id]),
      };
    });

    children.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    return [rootLane, ...children];
  }, [rootEvents, rootSessionId, tree, childEvents, delegations, settledCalls, attached, isLive]);

  return {
    lanes,
    langsmithUrl: tree?.langsmith?.url ?? null,
    research: tree?.research ?? {},
    attachedCount: Object.values(attached).filter(Boolean).length,
    refresh,
  };
}
