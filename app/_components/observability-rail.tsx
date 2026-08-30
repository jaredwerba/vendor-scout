"use client";

import {
  ActivityIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { actionName, actionOutcome, actionStatus, readCount, toolRuns } from "@/agent/lib/actions";
import { cacheHitRate, costFor, formatUsd } from "@/agent/lib/pricing";
import type { TraceEntry } from "@/agent/lib/trace";
import { cn } from "@/lib/utils";
import {
  deriveStack,
  StackDiagram,
  type StackEvent,
  type StackRuntime,
  type StackState,
} from "./agent-stack";
import { ModelPicker } from "./model-picker";
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
        // Shared with the trace store: a tool that reports its own failure in the
        // payload must not render as a green, successful call here.
        ok = actionOutcome(d) === "success";
        if (!ok) note = actionStatus(d) || String(d?.error?.message ?? "failed").slice(0, 90);
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
  refused: number;
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
    // Searches performed, not calls requested — see toolRuns.
    searches: toolRuns(s, "web_search"),
    vendors: s?.vendorsRecorded ?? 0,
    inputTokens: Math.max(derived.counts.inputTokens, s?.inputTokens ?? 0),
    outputTokens: Math.max(derived.counts.outputTokens, s?.outputTokens ?? 0),
    // Recomputed: stored costs written before the cache fix double-billed
    // cached reads and are ~1.9x too high.
    costUsd: s ? costFor(s.model, s) || s.costUsd || 0 : 0,
    failed: Math.max(derived.counts.failed, readCount(s?.failedActions)),
    refused: Math.max(derived.counts.refused, readCount(s?.refusedActions)),
    truncated: (s?.truncations ?? 0) > 0,
    durationMs: s?.durationMs ?? 0,
    subagents: Math.max(derived.counts.subagents, s?.subagents ?? 0),
  };
}

// ------------------------------------------------------------------ pieces

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

  // Collapsed by default. A fan-out is five or six agents, and a full stat
  // card each pushed the event stream off the screen entirely — the detail
  // belongs to whichever lane you are actually looking at.
  return (
    <button
      aria-expanded={selected}
      className="vlane"
      data-role={lane.role}
      data-selected={selected ? "true" : "false"}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center gap-2">
        <LaneDot lane={lane} />
        <span className="min-w-0 flex-1 truncate font-medium text-[13px]">{lane.label}</span>
        {stats.truncated ? (
          <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-px font-medium text-[9px] text-destructive uppercase">
            cut off
          </span>
        ) : null}
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {lane.role === "specialist" ? (
            <>
              <b className={cn("font-medium", stats.vendors > 0 && "text-primary")}>
                {stats.vendors}
              </b>{" "}
              found
            </>
          ) : (
            <>
              <b className="font-medium">{stats.subagents}</b> agents
            </>
          )}
        </span>
        <span className="w-12 shrink-0 text-right text-[10px] tabular-nums">
          {formatUsd(stats.costUsd)}
        </span>
      </div>

      {selected ? (
        <>
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{headline}</p>
          <dl className="mt-1.5 grid grid-cols-4 gap-1.5 text-[11px] tabular-nums">
            <Stat label="steps" value={fmt(stats.steps)} />
            <Stat label="tools" value={fmt(stats.toolCalls)} />
            <Stat label="searches" value={fmt(stats.searches)} />
            <Stat label="tokens" value={fmt(stats.inputTokens + stats.outputTokens)} />
          </dl>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground">
            {lane.summary?.model ? (
              <span className="font-mono" title={lane.summary.model}>
                {lane.summary.model.split("/").pop()}
              </span>
            ) : null}
            {stats.durationMs > 0 ? <span>{ms(stats.durationMs)}</span> : null}
            {lane.attached ? <span className="text-sage">live stream</span> : null}
            {stats.failed > 0 ? (
              <span className="text-destructive">{stats.failed} failed</span>
            ) : null}
            {stats.refused > 0 ? (
              <span title="The guards declined these on purpose — a directory source, an address that does not belong to the vendor, or a spent budget.">
                {stats.refused} refused
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </button>
  );
});

function LaneDot({ lane }: { readonly lane: Lane }) {
  const tone =
    lane.status === "failed"
      ? "bg-destructive"
      : lane.status === "live"
        ? "bg-sage"
        : lane.status === "done"
          ? "bg-primary/40"
          : "bg-muted-foreground/40";
  return (
    <span className="relative flex size-2 shrink-0">
      {lane.status === "live" ? (
        <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-70", tone)} />
      ) : null}
      <span className={cn("relative inline-flex size-2 rounded-full", tone)} />
    </span>
  );
}

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
          <p className="px-2 py-2 text-[11px] text-muted-foreground leading-relaxed">
            Every model step, tool call and result streams here as it happens, with the gap since
            the previous one.
          </p>
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
  /** Present only in the app, where a visitor may change the planner's model. */
  readonly plannerModel?: string | null;
  readonly onPlannerModel?: (id: string | null) => void;
}

export function ObservabilityRail({
  lanes,
  runtime,
  status,
  langsmithUrl,
  research,
  sessionId,
  variant = "rail",
  plannerModel,
  onPlannerModel,
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
    let cachedIn = 0;
    let totalIn = 0;
    for (const l of lanes) {
      const s = l.summary;
      cost += s ? costFor(s.model, s) || s.costUsd || 0 : 0;
      tokens += (s?.inputTokens ?? 0) + (s?.outputTokens ?? 0);
      vendors += s?.vendorsRecorded ?? 0;
      totalIn += s?.inputTokens ?? 0;
      cachedIn += s?.cacheReadTokens ?? 0;
    }
    const cached = totalIn > 0 ? cachedIn / totalIn : 0;
    if (vendors === 0 && research) {
      vendors = Object.values(research).reduce((a, b) => a + b, 0);
    }
    return { cost, tokens, vendors, cached };
  }, [lanes, research]);

  const liveCount = lanes.filter((l) => l.status === "live").length;

  return (
    <aside className="vbento" data-variant={variant}>
      {/* The picture. Always the first tile, always visible. */}
      <section className="vtile vtile-figure vtile-wide">
        <div className="vtile-head">
          <span>
            <b>Agent stack</b> — live
          </span>
          <span>
            {lanes.length} agent{lanes.length === 1 ? "" : "s"}
            {liveCount > 0 ? ` · ${liveCount} running` : ""}
          </span>
        </div>
        <StackDiagram compact runtime={runtime} state={state} status={status} />
        <PhaseStrip state={state} />
      </section>

      {/* What it is costing, and on what. */}
      <section className="vtile">
        <div className="vtile-head">
          <span>
            <b>This session</b>
          </span>
          <span>{runtime?.provider ?? "Nebius Token Factory"}</span>
        </div>
        {totals.tokens > 0 || totals.cost > 0 ? (
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Stat label="tokens" value={fmt(totals.tokens)} />
            <Stat label="cost" value={formatUsd(totals.cost)} />
            <Stat highlight={totals.vendors > 0} label="vendors" value={fmt(totals.vendors)} />
          </dl>
        ) : null}
        {totals.cached > 0 ? (
          <p
            className="text-[10px] text-muted-foreground"
            title="Token Factory serves a repeated prompt prefix from cache. A scout re-sends its brief on every step, so most of its input is cached — and about 40% faster."
          >
            {(totals.cached * 100).toFixed(0)}% of prompt tokens served from cache
          </p>
        ) : null}
        {totals.tokens === 0 ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Tokens and cost appear here per agent as soon as Venus starts — a plan runs about
            six agents.
          </p>
        ) : null}
        {onPlannerModel ? (
          <div className="border-t pt-1.5">
            <p className="mb-1 text-[10px] text-muted-foreground">Planner model</p>
            <ModelPicker onChange={onPlannerModel} value={plannerModel ?? null} />
          </div>
        ) : null}
        {runtime?.roles?.length ? (
          <dl className="mt-0.5 space-y-0.5 border-t pt-1.5 text-[10px]">
            {runtime.roles.map((r) => (
              <div className="flex items-baseline gap-1.5" key={r.role} title={r.rationale}>
                <dt className="w-[4.2rem] shrink-0 text-muted-foreground">{r.role}</dt>
                <dd className="truncate font-mono text-muted-foreground">
                  {r.model.split("/").pop()}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      {/* One tile per agent in the tree. */}
      <section className="vtile">
        <div className="vtile-head">
          <span>
            <b>Agents</b>
          </span>
          <span>{lanes.length === 1 ? "root only" : `root + ${lanes.length - 1}`}</span>
        </div>
        <div className="vlanes">
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
        </div>
        {lanes.length === 1 ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Venus sends out one research specialist per category once she has the brief. Each gets
            its own session, its own search budget, and its own tile here.
          </p>
        ) : null}
      </section>

      {/* The raw stream for whichever agent is selected. */}
      <section className="vtile vtile-wide">
        <div className="vtile-head">
          <span>
            <b>{selected?.label ?? "log"}</b> — event stream
          </span>
          {selected?.summary?.model ? (
            <span className="font-mono normal-case">
              {selected.summary.model.split("/").pop()}
            </span>
          ) : null}
        </div>
        <EventLog rows={rows} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
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
            <span
              title={
                runtime?.tracing
                  ? "Waiting for the first span of this session"
                  : "LANGSMITH_API_KEY not set"
              }
            >
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
          {sessionId ? (
            <span className="truncate font-mono opacity-60">{sessionId.slice(-12)}</span>
          ) : null}
        </div>
      </section>
    </aside>
  );
}

/**
 * The compact always-visible summary for screens with no room for the bento.
 * A phone cannot show a conversation and a dashboard at once, so it shows
 * that something is running, what it costs, and a way in.
 */
export function ObservabilityStrip({
  lanes,
  status,
  onOpen,
}: {
  readonly lanes: Lane[];
  readonly status: string;
  readonly onOpen: () => void;
}) {
  const live = lanes.filter((l) => l.status === "live").length;
  const cost = lanes.reduce((n, l) => n + (l.summary?.costUsd ?? 0), 0);
  const vendors = lanes.reduce((n, l) => n + (l.summary?.vendorsRecorded ?? 0), 0);
  const busy = status === "streaming" || status === "submitted" || live > 0;

  return (
    <button className="vstrip" onClick={onOpen} type="button">
      <span className="relative flex size-2 shrink-0">
        {busy ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose opacity-70" />
        ) : null}
        <span className="relative inline-flex size-2 rounded-full bg-rose" />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">
        <b className="font-medium">
          {lanes.length} agent{lanes.length === 1 ? "" : "s"}
        </b>
        {live > 0 ? <span className="text-muted-foreground"> · {live} running</span> : null}
        {vendors > 0 ? (
          <span className="text-muted-foreground"> · {vendors} vendors</span>
        ) : null}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{formatUsd(cost)}</span>
      <ActivityIcon className="size-4 shrink-0 text-primary" />
    </button>
  );
}
