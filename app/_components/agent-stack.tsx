"use client";

import { PauseIcon, PlayIcon, SkipBackIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/**
 * The agent stack, live. A faithful take on the "2026: Agent stack" diagram —
 * a control plane over a harness (plan · decide · act · observe · context ·
 * sub-agents) beside the tool, state and model planes — that lights up as
 * Venus's eve event stream arrives, so a couple (or a reviewer) can see which
 * part of the loop is running right now and where the work is happening.
 *
 * `deriveStack` folds the authoritative eve stream events into one state;
 * `AgentStack` renders it live; `AgentStackReplay` scrubs through a saved
 * session so the same picture can be replayed after the fact.
 */

export type StackNode =
  | "control" | "outcome" | "plan" | "decide" | "act" | "observe"
  | "context" | "subagents" | "tool" | "state" | "model";
export type StackEdge = "plan-act" | "act-observe" | "observe-decide" | "decide-plan" | "decide-outcome";

export interface StackEvent {
  readonly type: string;
  readonly data?: unknown;
}

export interface StackRuntime {
  readonly model?: string | null;
  readonly provider?: string | null;
  readonly tracing?: boolean;
  readonly project?: string | null;
}

export interface StackState {
  active: StackNode[];
  edge: StackEdge | null;
  phase: "idle" | "context" | "inference" | "acting" | "observing" | "waiting" | "done" | "failed" | "compacting";
  headline: string;
  detail: string;
  tool: string | null;
  counts: {
    turns: number; steps: number; toolCalls: number; toolResults: number; subagents: number;
    questions: number; inputTokens: number; outputTokens: number; failed: number;
  };
  lastType: string | null;
  seen: number;
}

// biome-ignore lint/suspicious/noExplicitAny: eve protocol projection
type Any = any;

/** Where each of Venus's tools does its work, in agent-stack terms. */
const TOOL_META: Record<string, { plane: StackNode; label: string; also?: StackNode }> = {
  web_search: { plane: "tool", label: "Tavily web search" },
  send_outreach: { plane: "tool", label: "Resend · vendor email", also: "state" },
  cancel_followups: { plane: "state", label: "roster (KV)" },
  check_outreach_status: { plane: "state", label: "roster (KV) · read" },
  log_vendor_reply: { plane: "state", label: "roster (KV) · reply filed" },
  mark_vendor_booked: { plane: "state", label: "roster (KV) · booked" },
  save_wedding_plan: { plane: "state", label: "curated gallery (KV) · archive" },
  generate_wedding_timeline: { plane: "state", label: "countdown (KV) · milestones" },
  check_timeline: { plane: "state", label: "countdown (KV) · read" },
  complete_milestone: { plane: "state", label: "countdown (KV) · done" },
  ask_question: { plane: "control", label: "human input (buttons)" },
  agent: { plane: "subagents", label: "specialist sub-agent" },
  load_skill: { plane: "context", label: "skill loaded" },
};

export function actionName(a: Any): string {
  return String(a?.toolName ?? a?.name ?? a?.tool?.name ?? a?.skill ?? a?.kind ?? "action");
}

function toolMeta(name: string) {
  return TOOL_META[name] ?? { plane: "tool" as StackNode, label: name };
}

function initial(): StackState {
  return {
    active: [], edge: null, phase: "idle", headline: "Waiting for you", detail: "nothing running", tool: null,
    counts: { turns: 0, steps: 0, toolCalls: 0, toolResults: 0, subagents: 0, questions: 0, inputTokens: 0, outputTokens: 0, failed: 0 },
    lastType: null, seen: 0,
  };
}

function fold(st: StackState, ev: StackEvent, inSub = false): void {
  const d = (ev.data ?? {}) as Any;
  const sub = (nodes: StackNode[]) => (inSub ? Array.from(new Set<StackNode>([...nodes, "subagents"])) : nodes);
  st.lastType = ev.type;
  switch (ev.type) {
    case "turn.started":
      st.counts.turns += 1;
      st.phase = "context"; st.active = ["context", "control"]; st.edge = null;
      st.headline = "Assembling context"; st.detail = `turn ${st.counts.turns} · instructions + history`; st.tool = null;
      break;
    case "message.received":
      st.phase = "context"; st.active = sub(["context"]); st.edge = null;
      st.headline = "Your message landed"; st.detail = "building the model input";
      break;
    case "step.started":
      st.counts.steps += 1;
      st.phase = "inference"; st.active = sub(["model", "plan"]); st.edge = "decide-plan";
      st.headline = inSub ? "Specialist thinking" : "Model inference"; st.detail = `step ${st.counts.steps} · Nebius Token Factory`; st.tool = null;
      break;
    case "reasoning.appended":
    case "reasoning.completed":
      st.phase = "inference"; st.active = sub(["model", "plan"]); st.edge = null;
      st.headline = "Planning"; st.detail = "reasoning before acting";
      break;
    case "message.appended":
      st.phase = "inference"; st.active = sub(["model", "decide"]); st.edge = null;
      st.headline = inSub ? "Specialist reporting" : "Writing to you"; st.detail = "streaming the reply";
      break;
    case "actions.requested": {
      const actions: Any[] = Array.isArray(d.actions) ? d.actions : [];
      const last = actions[actions.length - 1];
      const name = last ? actionName(last) : "action";
      for (const a of actions) {
        st.counts.toolCalls += 1;
        if (actionName(a) === "ask_question") st.counts.questions += 1;
      }
      const meta = toolMeta(name);
      st.tool = name;
      st.phase = "acting"; st.edge = "plan-act";
      st.active = sub(["act", meta.plane, ...(meta.also ? [meta.also] : [])]);
      st.headline = name === "agent" ? "Delegating to a specialist" : `Acting · ${name}`;
      st.detail = `${meta.label}${actions.length > 1 ? ` (+${actions.length - 1} more)` : ""}`;
      break;
    }
    case "action.result": {
      const name = actionName(d.result);
      const ok = d.status !== "failed" && !d.error && !d?.result?.isError;
      st.counts.toolResults += 1; if (!ok) st.counts.failed += 1;
      const meta = toolMeta(name);
      st.tool = name;
      st.phase = "observing"; st.edge = "act-observe";
      st.active = sub(["observe", meta.plane]);
      st.headline = ok ? `Observing · ${name}` : `Tool failed · ${name}`;
      st.detail = ok ? `${meta.label} → back into the loop` : String(d?.error?.message ?? "error returned to the model");
      break;
    }
    case "input.requested":
      st.counts.questions += Array.isArray(d.requests) ? d.requests.length : 1;
      st.phase = "waiting"; st.active = ["control", "decide"]; st.edge = "observe-decide";
      st.headline = "Waiting on you"; st.detail = "buttons are up — your call decides the next loop";
      break;
    case "subagent.called":
    case "subagent.started":
      st.counts.subagents += 1;
      st.phase = "acting"; st.active = ["subagents", "model"]; st.edge = "plan-act";
      st.headline = `Specialist started · ${d.name ?? d.subagentName ?? "research"}`; st.detail = "fresh context, own loop, reports back";
      break;
    case "subagent.event":
      if (d.event) fold(st, d.event as StackEvent, true);
      break;
    case "subagent.completed":
      st.phase = "observing"; st.active = ["observe", "subagents"]; st.edge = "act-observe";
      st.headline = `Specialist reported · ${d.subagentName ?? ""}`.trim(); st.detail = "findings folded into the plan";
      break;
    case "step.completed": {
      const u = d.usage ?? {};
      st.counts.inputTokens += Number(u.inputTokens ?? 0); st.counts.outputTokens += Number(u.outputTokens ?? 0);
      st.phase = "inference"; st.active = sub(["control", "decide"]); st.edge = "observe-decide";
      st.headline = "Step finished"; st.detail = `finish: ${d.finishReason ?? "?"} · budget & trace recorded`;
      break;
    }
    case "message.completed":
      st.active = sub(["decide"]); st.edge = null; st.headline = "Reply complete"; st.detail = `finish: ${d.finishReason ?? "?"}`;
      break;
    case "turn.completed":
      st.phase = "done"; st.active = ["outcome"]; st.edge = "decide-outcome"; st.tool = null;
      st.headline = "Final outcome delivered"; st.detail = `turn ${st.counts.turns} settled`;
      break;
    case "turn.cancelled":
      st.phase = "idle"; st.active = ["control"]; st.edge = null; st.headline = "Turn cancelled"; st.detail = "stopped before finishing";
      break;
    case "step.failed":
    case "turn.failed":
    case "session.failed":
      st.counts.failed += 1;
      st.phase = "failed"; st.active = ["control"]; st.edge = null;
      st.headline = "Something failed"; st.detail = `${d.code ?? "error"} · ${String(d.message ?? "").slice(0, 90)}`;
      break;
    case "session.waiting":
      if (st.phase !== "done" && st.phase !== "failed") { st.phase = "idle"; st.active = []; st.edge = null; st.headline = "Waiting for you"; st.detail = "nothing running"; }
      break;
    case "compaction.requested":
    case "compaction.completed":
      st.phase = "compacting"; st.active = ["context", "state"]; st.edge = null;
      st.headline = "Compacting memory"; st.detail = "older turns summarised to stay within the window";
      break;
    default:
      break;
  }
}

export function deriveStack(events: readonly StackEvent[]): StackState {
  const st = initial();
  for (const ev of events) fold(st, ev);
  st.seen = events.length;
  return st;
}

/** Event types that mark a real change of phase (used for replay stepping). */
const STEP_TYPES = new Set([
  "turn.started", "message.received", "step.started", "actions.requested", "action.result", "input.requested",
  "subagent.called", "subagent.started", "subagent.completed", "step.completed", "message.completed",
  "turn.completed", "turn.failed", "step.failed", "session.failed", "session.waiting", "compaction.requested",
]);

const fmt = (n: number) => n.toLocaleString("en-US");

export function StackDiagram({
  state, runtime, compact, status,
}: {
  readonly state: StackState;
  readonly runtime?: StackRuntime | null;
  readonly compact?: boolean;
  readonly status?: string;
}) {
  const on = (n: StackNode) => (state.active.includes(n) ? "true" : "false");
  const edge = (e: StackEdge) => (state.edge === e ? "true" : "false");
  const model = (runtime?.model ?? "").trim() || "Qwen/Qwen3-235B-A22B-Instruct-2507";
  const live = status === "streaming" || status === "submitted";
  return (
    <div className="vstack" data-compact={compact ? "true" : "false"} data-phase={state.phase}>
      <div className="vstack-top">
        <div className="vstack-plane vstack-control" data-on={on("control")}>
          <b>Control plane</b>
          <i>permissions, budget, traces, evals</i>
          <span className="vstack-badge">
            {runtime?.tracing ? `traces → LangSmith · ${runtime.project ?? "venus"}` : "traces → KV (/observe)"}
            {" · "}
            {fmt(state.counts.inputTokens + state.counts.outputTokens)} tokens
          </span>
        </div>
        <div className="vstack-outcome" data-on={on("outcome")}>Final outcome</div>
      </div>
      <div className="vstack-body">
        <div className="vstack-harness">
          <div className="vstack-harness-title">Harness</div>
          <div className="vstack-loop">
            <div className="vstack-node" data-on={on("plan")}>Plan</div>
            <div className="vstack-arrow" data-dir="left" data-on={edge("decide-plan")}>←</div>
            <div className="vstack-node" data-on={on("decide")}>Decide</div>
            <div className="vstack-arrow" data-dir="down" data-on={edge("plan-act")}>↓</div>
            <div />
            <div className="vstack-arrow" data-dir="up" data-on={edge("observe-decide")}>↑</div>
            <div className="vstack-node" data-on={on("act")}>Act</div>
            <div className="vstack-arrow" data-dir="right" data-on={edge("act-observe")}>→</div>
            <div className="vstack-node" data-on={on("observe")}>Observe</div>
          </div>
          <div className="vstack-extra">
            <div className="vstack-node" data-on={on("context")}>Context</div>
            <div className="vstack-node" data-on={on("subagents")}>
              Sub-agents{state.counts.subagents ? ` · ${state.counts.subagents}` : ""}
            </div>
          </div>
        </div>
        <div className="vstack-planes">
          <div className="vstack-plane vstack-tool" data-on={on("tool")}>
            <b>Tool plane</b>
            <i>Tavily search, Resend email, ask_question</i>
          </div>
          <div className="vstack-plane vstack-state" data-on={on("state")}>
            <b>State</b>
            <i>Upstash KV: roster, countdown, gallery</i>
          </div>
          <div className="vstack-plane vstack-model" data-on={on("model")}>
            <b>Model plane</b>
            <i>{runtime?.provider ?? "Nebius Token Factory"} · {model}</i>
          </div>
        </div>
      </div>
      <div className="vstack-caption">
        <span className="vstack-dot" data-live={live ? "true" : "false"} />
        <span><b>{state.headline}</b> — {state.detail}</span>
        <span>steps {state.counts.steps}</span>
        <span>tools {state.counts.toolCalls}</span>
        <span>specialists {state.counts.subagents}</span>
        <span>tokens {fmt(state.counts.inputTokens)} in / {fmt(state.counts.outputTokens)} out</span>
        {state.counts.failed ? <span className="text-destructive">failures {state.counts.failed}</span> : null}
      </div>
    </div>
  );
}

/** Live: folds the session's authoritative event stream as it arrives. */
export function AgentStack({
  events, runtime, compact, status,
}: {
  readonly events: readonly StackEvent[];
  readonly runtime?: StackRuntime | null;
  readonly compact?: boolean;
  readonly status?: string;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: events is append-only; length is the cheap cursor
  const state = useMemo(() => deriveStack(events), [events.length]);
  return <StackDiagram compact={compact} runtime={runtime} state={state} status={status} />;
}

/** Replay: scrub or play through a saved session's events on the same diagram. */
export function AgentStackReplay({
  events, runtime,
}: {
  readonly events: readonly StackEvent[];
  readonly runtime?: StackRuntime | null;
}) {
  const marks = useMemo(() => {
    const m: number[] = [];
    events.forEach((e, i) => { if (STEP_TYPES.has(e.type)) m.push(i); });
    if (m.length === 0 && events.length > 0) m.push(events.length - 1);
    return m;
  }, [events]);
  const [pos, setPos] = useState(() => Math.max(0, marks.length - 1));
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (pos >= marks.length - 1) { setPlaying(false); return; }
    const id = window.setTimeout(() => setPos((p) => Math.min(marks.length - 1, p + 1)), 650);
    return () => window.clearTimeout(id);
  }, [playing, pos, marks.length]);
  const upto = marks.length ? marks[Math.min(pos, marks.length - 1)] + 1 : 0;
  const state = useMemo(() => deriveStack(events.slice(0, upto)), [events, upto]);
  const current = events[upto - 1];
  if (events.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <StackDiagram runtime={runtime} state={state} status={playing ? "streaming" : "ready"} />
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card/70 px-3 py-2 text-xs">
        <button
          aria-label="Restart"
          className="flex size-8 items-center justify-center rounded-full hover:bg-muted"
          onClick={() => { setPos(0); setPlaying(true); }}
          type="button"
        >
          <SkipBackIcon className="size-4" />
        </button>
        <button
          aria-label={playing ? "Pause" : "Play"}
          className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
          onClick={() => { if (!playing && pos >= marks.length - 1) setPos(0); setPlaying((p) => !p); }}
          type="button"
        >
          {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        </button>
        <input
          aria-label="Scrub through the session"
          className="venus-slider h-[18px] min-w-40 flex-1 cursor-pointer appearance-none bg-transparent"
          max={Math.max(0, marks.length - 1)}
          min={0}
          onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }}
          style={{ background: "var(--muted) no-repeat center / 100% 6px", borderRadius: 9999 }}
          type="range"
          value={Math.min(pos, Math.max(0, marks.length - 1))}
        />
        <span className="text-muted-foreground tabular-nums">
          {Math.min(pos + 1, marks.length)}/{marks.length} · {current?.type ?? ""}
        </span>
      </div>
    </div>
  );
}
