/**
 * Wall clock for a wedding plan: starts on the couple's last context message
 * before specialists go out, and stops when the three visions (and their
 * pick) land.
 *
 * Pure so a script can assert the boundaries without a browser. The rail
 * only renders what this returns.
 */
import { actionName, isSubagentAction } from "./actions";
import type { TraceEntry } from "./trace";

export interface ClockEvent {
  readonly type: string;
  readonly at: number | null;
  readonly user: boolean;
  readonly scout: boolean;
  readonly gate: boolean;
}

export interface ClockOptions {
  readonly fallbackUserAt?: number | null;
  readonly fallbackStartAt?: number | null;
  readonly stillRunning?: boolean;
}

export interface ResearchClock {
  readonly startedAt: number | null;
  readonly endedAt: number | null;
}

export interface LiveClockSource {
  readonly type: string;
  readonly data?: unknown;
  readonly meta?: { at?: string };
}

// biome-ignore lint/suspicious/noExplicitAny: eve protocol projection
type Any = any;

function atMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

function isScoutAction(a: Any): boolean {
  if (isSubagentAction(a)) return true;
  const name = actionName(a);
  return name === "scout" || name === "agent";
}

function isScoutRequested(data: Any): boolean {
  const actions: Any[] = Array.isArray(data?.actions) ? data.actions : [];
  return actions.some(isScoutAction);
}

export function clockEventFromLive(ev: LiveClockSource): ClockEvent {
  const data = (ev.data ?? {}) as Any;
  return {
    type: ev.type,
    at: atMs(ev.meta?.at),
    user: ev.type === "message.received",
    scout: ev.type === "subagent.called" || (ev.type === "actions.requested" && isScoutRequested(data)),
    gate: ev.type === "input.requested",
  };
}

export function clockEventFromEntry(entry: TraceEntry): ClockEvent {
  const tool = entry.tool ?? "";
  return {
    type: entry.type,
    at: atMs(entry.t),
    user: entry.type === "message.received",
    scout:
      entry.type === "subagent.called" ||
      (entry.type === "actions.requested" && (tool === "scout" || tool === "agent")),
    gate: entry.type === "input.requested",
  };
}

/** Live stream if it has anything; otherwise the persisted, redacted log. */
export function clockEventsFrom(
  live: readonly LiveClockSource[] | null | undefined,
  persisted: readonly TraceEntry[] | null | undefined,
): ClockEvent[] {
  if (live && live.length > 0) return live.map(clockEventFromLive);
  if (persisted && persisted.length > 0) return persisted.map(clockEventFromEntry);
  return [];
}

/**
 * Last `message.received` before the first specialist dispatch is the brief.
 * The first `input.requested` after that is the three-vision gate. Interview
 * questions (a gate before any scout) are ignored.
 */
export function deriveResearchClock(
  events: readonly ClockEvent[],
  options: ClockOptions = {},
): ResearchClock {
  let lastUser: number | null = null;
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  let lastAt: number | null = null;

  for (const ev of events) {
    if (ev.at !== null) lastAt = ev.at;
    if (ev.user && ev.at !== null) lastUser = ev.at;
    if (!startedAt && ev.scout) {
      startedAt = lastUser ?? options.fallbackUserAt ?? ev.at ?? options.fallbackStartAt ?? null;
    }
    if (startedAt && !endedAt && ev.gate) {
      endedAt = ev.at;
    }
  }

  if (!startedAt && options.fallbackStartAt) {
    startedAt = options.fallbackUserAt ?? options.fallbackStartAt;
  }

  if (startedAt && !endedAt && !options.stillRunning) {
    endedAt = lastAt;
  }

  return { startedAt, endedAt };
}

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
