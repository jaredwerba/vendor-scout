"use client";

import {
  ActivityIcon,
  ChevronRightIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { actionName } from "@/agent/lib/actions";
import { formatUsd } from "@/agent/lib/pricing";
import type { TraceEntry } from "@/agent/lib/trace";
import { cn } from "@/lib/utils";
import {
  deriveStack,
  StackDiagram,
  type StackEvent,
  type StackRuntime,
  type StackState,
} from "./agent-stack";
import type { Lane } from "./use-agent-lanes";

/**
 * The observability rail: what every agent in the tree is doing, right now.
 *
 * This is the part of the product that is not the wedding. It answers, for
 * Venus and for each research specialist independently: where in the
 * plan → act → observe → decide loop is it, which plane is it working on,
 * how many tokens and dollars has it spent, how long has it been running,
 * what did it just do, and what failed. The same component renders beside the
 * chat and on the /observe console.
 */

// The loop, in the order the diagram draws it.
const PHASES = [
  { key: "plan", label: "Plan", of: ["inference", "context", "compacting"] },
  { key: "act", label: "Act", of: ["acting"] },
  { key: "observe", label: "Observe", of: ["observing"] },
  { key: "decide", label: "Decide", of: ["waiting", "done", "idle", "failed"] },
] as const;

function phaseIndex(phase: StackState["phase"]): number {
  return PHASES.findIndex((p) => (p.of as readonly string[]).includes(phase));
}

const fmt = (n: number) => n.toLocaleString("en-US");

function ms(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1000)}s`;
}

// ---------------------------------------------------------------- log rows

interface LogRow {
  key: string;
  at: string | null;
  dt: number | null;
  type: string;
  tool?: string;
  note?: string;
  ok?: boolean;
  tokens?: { in: number; out: number };
  cost?: number;
}

// biome-ignore lint/suspicious/noExplicitAny: eve protocol projection
type Any = any;

const NOISE = new Set(["message.appended", "reasoning.appended", "reasoning.completed"]);

/** Live stream events -> rows. Richer than KV: it still has the raw payload. */
function rowsFromEvents(events: readonly StackEvent[]): LogRow[] {
  const rows: LogRow[] = [];
  let prev: number | null = null;
  events.forEach((ev, i) => {
    if (NOISE.has(ev.type)) return;
    const d = (ev.data ?? {}) as Any;
    const at = (ev as Any).meta?.at ?? null;
    const ts = at ? Date.parse(at) : NaN;
    const dt = prev !== null && Number.isFinite(ts) ? ts - prev : null;
    if (Number.isFinite(ts)) prev = ts;

    let tool: string | undefined;
    let note: string | undefined;
    let ok: boolean | undefined;
    let tokens: { in: number; out: number } | undefined;

    switch (ev.type) {
      case "actions.requested": {
        const actions: Any[] = Array.isArray(d.actions) ? d.actions : [];
        const last = actions[actions.length - 1];
        tool = last ? actionName(last) : undefined;
        const input = (last?.input ?? {}) as Record<string, unknown>;
        if (typeof input.query === "string") note = `"${input.query.slice(0, 70)}"`;
        else if (typeof input.name === "string") note = String(input.name).slice(0, 60);
        else if (typeof input.message === "string") {
          note = input.message.split("\n", 1)[0]?.slice(0, 60);
        }
        if (actions.length > 1) note = `${note ?? ""} (+${actions.length - 1})`.trim();
        break;
      }
      case "action.result":
        tool = actionName(d.result);
        ok = d.status !== "failed" && !d.error && !d?.result?.isError;
        if (!ok) note = String(d?.error?.message ?? "failed").slice(0, 90);
        break;
      case "step.completed": {
        const u = d.usage ?? {};
        tokens = { in: Number(u.inputTokens ?? 0), out: Number(u.outputTokens ?? 0) };
        ok = d.finishReason !== "length";
        note = d.finishReason === "length" ? "TRUNCATED" : `finish: ${d.finishReason ?? "?"}`;
        break;
      }
      case "subagent.called":
        note = `${d.subagentName ?? d.name ?? "specialist"} → ${String(d.childSessionId ?? "").slice(-8)}`;
        break;
      case "step.failed":
      case "turn.failed":
      case "session.failed":
        ok = false;
        note = `${d.code ?? "error"}: ${String(d.message ?? "").slice(0, 90)}`;
        break;
      case "message.received":
        note = typeof d.message === "string" ? `${d.message.length} chars` : undefined;
        break;
      default:
        break;
    }
    rows.push({ key: `e${i}`, at, dt, type: ev.type, tool, note, ok, tokens });
  });
  return rows;
}

/** Persisted (redacted) entries -> the same rows, after a reload. */
function rowsFromEntries(entries: readonly TraceEntry[]): LogRow[] {
  return entries.map((e, i) => ({
    key: `p${i}`,
    at: e.t,
    dt: e.dt ?? null,
    type: e.type,
    tool: e.tool,
    note: e.note ?? e.name,
    ok: e.ok,
    tokens: e.tokens,
    cost: e.costUsd,
  }));
}

type LogFilter = "all" | "tools" | "model" | "control";

function passes(row: LogRow, filter: LogFilter): boolean {
  if (filter === "all") return true;
  if (filter === "tools") return row.type === "actions.requested" || row.type === "action.result";
  if (filter === "model") return row.type.startsWith("step.") || row.type.startsWith("message.");
  return row.type.startsWith("turn.") || row.type.startsWith("session.") ||
    row.type === "input.requested" || row.type.startsWith("subagent.") ||
    row.type.startsWith("compaction.");
}

// ------------------------------------------------------------- lane stats

interface LaneStats {
  steps: number;
  toolCalls: number;
  searches: number;
  vendors: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  failed: number;
  truncated: boolean;
  durationMs: number;
  subagents: number;
}

function laneStats(lane: Lane, derived: StackState): LaneStats {
  const s = lane.summary;
  // KV is authoritative for anything it computes (cost, vendors recorded);
  // the live stream is authoritative for anything happening right now.
  return {
    steps: Math.max(derived.counts.steps, s?.steps ?? 0),
    toolCalls: Math.max(derived.counts.toolCalls, s?.toolCalls ?? 0),
    searches: s?.tools?.web_search ?? 0,
    vendors: s?.vendorsRecorded ?? 0,
    inputTokens: Math.max(derived.counts.inputTokens, s?.inputTokens ?? 0),
    outputTokens: Math.max(derived.counts.outputTokens, s?.outputTokens ?? 0),
    costUsd: s?.costUsd ?? 0,
    failed: Math.max(derived.counts.failed, s?.failedActions ?? 0),
    truncated: (s?.truncations ?? 0) > 0,
    durationMs: s?.durationMs ?? 0,
    subagents: Math.max(derived.counts.subagents, s?.subagents ?? 0),
  };
}

// ------------------------------------------------------------------ pieces

function StatusPill({ lane, headline }: { readonly lane: Lane; readonly headline: string }) {
  const tone =
    lane.status === "failed"
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : lane.status === "live"
        ? "bg-sage/15 text-foreground border-sage/40"
        : "bg-muted text-muted-foreground border-transparent";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-0.5 font-medium text-[11px]",
        tone,
      )}
    >
      {lane.status === "live" ? (
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-sage opacity-70" />
          <span className="relative inline-flex size-1.5 rounded-full bg-sage" />
        </span>
      ) : lane.status === "failed" ? (
        <TriangleAlertIcon className="size-3 shrink-0" />
      ) : (
        <CircleDotIcon className="size-3 shrink-0 opacity-60" />
      )}
      <span className="truncate">{headline}</span>
    </span>
  );
}

function PhaseStrip({ state }: { readonly state: StackState }) {
  const active = phaseIndex(state.phase);
  return (
    <div className="vrail-phases" role="group" aria-label="Agent loop phase">
      {PHASES.map((p, i) => (
        <div
          className="vrail-phase"
          data-state={i === active ? "active" : i < active ? "done" : "idle"}
          key={p.key}
        >
          <span>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

const LaneCard = memo(function LaneCard({
  lane,
  selected,
  onSelect,
}: {
  readonly lane: Lane;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: events are append-only
  const derived = useMemo(() => deriveStack(lane.events), [lane.events.length]);
  const stats = laneStats(lane, derived);
  const headline = lane.events.length > 0 ? derived.headline : (lane.summary?.lastEvent ?? "queued");

  return (
    <button
      aria-pressed={selected}
      className={cn(
        "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected ? "border-primary/50 bg-primary/5" : "border-border/70 bg-card/60 hover:bg-muted/50",
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-sm">{lane.label}</span>
          <span className="shrink-0 rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground uppercase">
            {lane.role === "root" ? "root" : (lane.agentName ?? "scout")}
          </span>
        </span>
        {stats.truncated ? (
          <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-px font-medium text-[10px] text-destructive">
            truncated
          </span>
        ) : null}
      </div>

      <div className="mt-1.5">
        <StatusPill headline={headline} lane={lane} />
      </div>

      <dl className="mt-2 grid grid-cols-4 gap-1.5 text-[11px] tabular-nums">
        <Stat label="steps" value={fmt(stats.steps)} />
        <Stat label="tools" value={fmt(stats.toolCalls)} />
        {lane.role === "specialist" ? (
          <Stat highlight={stats.vendors > 0} label="found" value={fmt(stats.vendors)} />
        ) : (
          <Stat label="agents" value={fmt(stats.subagents)} />
        )}
        <Stat label="cost" value={formatUsd(stats.costUsd)} />
      </dl>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground tabular-nums">
        <span>
          {fmt(stats.inputTokens)} in / {fmt(stats.outputTokens)} out
        </span>
        {stats.durationMs > 0 ? <span>{ms(stats.durationMs)}</span> : null}
        {stats.searches > 0 ? <span>{stats.searches} searches</span> : null}
        {lane.attached ? <span className="text-sage">stream attached</span> : null}
        {stats.failed > 0 ? <span className="text-destructive">{stats.failed} failed</span> : null}
      </div>
    </button>
  );
});

function Stat({
  label,
  value,
  highlight,
}: {
  readonly label: string;
  readonly value: string;
  readonly highlight?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-medium", highlight && "text-primary")}>{value}</dd>
    </div>
  );
}

function EventLog({ rows }: { readonly rows: LogRow[] }) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const shown = useMemo(() => rows.filter((r) => passes(r, filter)).slice(-120), [rows, filter]);
  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {(["all", "tools", "model", "control"] as const).map((f) => (
          <button
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] transition-colors",
              filter === f ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
            key={f}
            onClick={() => setFilter(f)}
            type="button"
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{shown.length}</span>
      </div>
      <div className="vrail-log">
        {shown.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">No events yet.</p>
        ) : (
          shown.map((r) => (
            <div className="vrail-log-row" data-ok={r.ok === false ? "false" : "true"} key={r.key}>
              <span className="vrail-log-dt">{r.dt !== null ? `+${ms(r.dt)}` : ""}</span>
              <span className="vrail-log-type">{r.type}</span>
              <span className="vrail-log-tool">{r.tool ?? ""}</span>
              <span className="vrail-log-note">{r.note ?? ""}</span>
              <span className="vrail-log-tok">
                {r.tokens && (r.tokens.in || r.tokens.out)
                  ? `${fmt(r.tokens.in)}/${fmt(r.tokens.out)}`
                  : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- rail

export interface ObservabilityRailProps {
  readonly lanes: Lane[];
  readonly runtime?: StackRuntime | null;
  readonly status: string;
  readonly langsmithUrl?: string | null;
  readonly research?: Record<string, number>;
  readonly sessionId?: string | null;
  /** "rail" sits beside the chat; "console" is the standalone /observe page. */
  readonly variant?: "rail" | "console";
}

export function ObservabilityRail({
  lanes,
  runtime,
  status,
  langsmithUrl,
  research,
  sessionId,
  variant = "rail",
}: ObservabilityRailProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Follow the newest specialist automatically until the reader picks one.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (pinned) return;
    const live = lanes.filter((l) => l.status === "live");
    const next = live.length > 1 ? live[live.length - 1] : lanes[0];
    if (next && next.id !== selectedId) setSelectedId(next.id);
  }, [lanes, pinned, selectedId]);

  const selected = lanes.find((l) => l.id === selectedId) ?? lanes[0] ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: events are append-only
  const state = useMemo(
    () => deriveStack(selected?.events ?? []),
    [selected?.id, selected?.events.length],
  );
  const rows = useMemo(() => {
    if (!selected) return [];
    return selected.events.length > 0
      ? rowsFromEvents(selected.events)
      : rowsFromEntries(selected.entries);
  }, [selected?.id, selected?.events.length, selected?.entries.length]);

  const totals = useMemo(() => {
    let cost = 0;
    let tokens = 0;
    let vendors = 0;
    for (const l of lanes) {
      cost += l.summary?.costUsd ?? 0;
      tokens += (l.summary?.inputTokens ?? 0) + (l.summary?.outputTokens ?? 0);
      vendors += l.summary?.vendorsRecorded ?? 0;
    }
    if (vendors === 0 && research) {
      vendors = Object.values(research).reduce((a, b) => a + b, 0);
    }
    return { cost, tokens, vendors };
  }, [lanes, research]);

  return (
    <aside className="vrail" data-variant={variant}>
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-medium text-sm">
          <ActivityIcon className="size-4 text-primary" />
          Agent stack — live
        </h2>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
          {lanes.length} agent{lanes.length === 1 ? "" : "s"}
        </span>
      </header>

      <StackDiagram compact runtime={runtime} state={state} status={status} />
      <PhaseStrip state={state} />

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Agents
        </h3>
        {lanes.map((lane) => (
          <LaneCard
            key={lane.id}
            lane={lane}
            onSelect={() => {
              setPinned(true);
              setSelectedId(lane.id);
            }}
            selected={lane.id === selected?.id}
          />
        ))}
        {lanes.length === 1 ? (
          <p className="rounded-xl border border-dashed px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
            Venus delegates one research specialist per category once she has the brief. Each one
            gets its own session, its own tool budget, and its own lane here.
          </p>
        ) : null}
      </section>

      <section className="flex min-h-0 flex-col gap-2">
        <h3 className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          <ChevronRightIcon className="size-3" />
          {selected?.label ?? "log"}
        </h3>
        <EventLog rows={rows} />
      </section>

      <footer className="flex flex-col gap-1.5 border-t pt-2.5 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
          <span>{fmt(totals.tokens)} tokens</span>
          <span>{formatUsd(totals.cost)}</span>
          {totals.vendors > 0 ? <span>{totals.vendors} vendors recorded</span> : null}
        </div>
        <div className="truncate">
          {runtime?.provider ?? "Nebius Token Factory"} · {(runtime?.model ?? "").split("/").pop()}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {langsmithUrl ? (
            <a
              className="inline-flex items-center gap-1 text-primary hover:underline"
              href={langsmithUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open trace in LangSmith <ExternalLinkIcon className="size-3" />
            </a>
          ) : (
            <span title={runtime?.tracing ? "Waiting for the first span of this session" : "LANGSMITH_API_KEY not set"}>
              LangSmith {runtime?.tracing ? "· trace pending" : "· off"}
            </span>
          )}
          {variant === "rail" && sessionId ? (
            <a
              className="inline-flex items-center gap-1 hover:underline"
              href={`/observe?session=${encodeURIComponent(sessionId)}`}
            >
              Full console <ExternalLinkIcon className="size-3" />
            </a>
          ) : null}
        </div>
        {sessionId ? (
          <div className="truncate font-mono text-[10px] opacity-70">{sessionId}</div>
        ) : null}
      </footer>
    </aside>
  );
}
