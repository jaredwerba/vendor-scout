/**
 * One reading of eve's runtime action protocol, shared by the trace store
 * (agent/lib/trace.ts) and the UI (app/_components/*). Both used to carry
 * their own copy, and both got subagent calls wrong: a delegated child
 * rendered as "subagent-result" because `toolName` is absent on that shape,
 * and delegation was detected by duck-typing `input.message`.
 *
 * Action shapes (node_modules/eve/dist/src/runtime/actions/types.d.ts):
 *   request  { kind: "tool-call",         callId, toolName, input }
 *            { kind: "subagent-call",     callId, subagentName, name, nodeId, input }
 *            { kind: "remote-agent-call", callId, remoteAgentName, name, nodeId, input }
 *            { kind: "load-skill",        callId, input }
 *   result   { kind: "tool-result",       callId, toolName, output, isError? }
 *            { kind: "subagent-result",   callId, subagentName, output, usage?, isError? }
 *            { kind: "load-skill-result", callId, name?, output, isError? }
 */

// biome-ignore lint/suspicious/noExplicitAny: protocol projection, read defensively
type Any = any;

export type ActionKind =
  | "tool-call" | "subagent-call" | "remote-agent-call" | "load-skill"
  | "tool-result" | "subagent-result" | "load-skill-result" | "unknown";

export function actionKind(a: Any): ActionKind {
  const k = a?.kind;
  return typeof k === "string" ? (k as ActionKind) : "unknown";
}

/** The name a human should see for an action request or result. */
export function actionName(a: Any): string {
  switch (actionKind(a)) {
    case "subagent-call":
    case "subagent-result":
      return String(a?.subagentName ?? a?.name ?? "subagent");
    case "remote-agent-call":
      return String(a?.remoteAgentName ?? a?.name ?? "remote-agent");
    case "load-skill":
    case "load-skill-result":
      return "load_skill";
    default:
      return String(a?.toolName ?? a?.subagentName ?? a?.name ?? a?.kind ?? "action");
  }
}

/** True for a delegated specialist call/result (never for an ordinary tool). */
export function isSubagentAction(a: Any): boolean {
  const k = actionKind(a);
  return k === "subagent-call" || k === "subagent-result" || k === "remote-agent-call";
}

/** UI: is this rendered message part a delegation to a specialist? */
export function isDelegationPart(part: Any): boolean {
  return part?.toolMetadata?.eve?.kind === "subagent-call";
}

/** Token usage carried by step.completed and by a subagent-result. */
export interface ActionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function readUsage(u: Any): ActionUsage {
  return {
    inputTokens: Number(u?.inputTokens ?? 0) || 0,
    outputTokens: Number(u?.outputTokens ?? 0) || 0,
    cacheReadTokens: Number(u?.cacheReadTokens ?? 0) || 0,
    cacheWriteTokens: Number(u?.cacheWriteTokens ?? 0) || 0,
  };
}

/**
 * Every research brief opens with `CATEGORY: <venue | photography | ...>`
 * (agent/subagents/scout/instructions.md). That first line is how a
 * specialist lane gets its label and how findings get filed.
 */
export const RESEARCH_CATEGORIES = [
  "venue", "photography", "catering", "florals", "music", "styling & details",
] as const;
export type ResearchCategory = string;

export function categoryFromBrief(message: unknown): string | null {
  if (typeof message !== "string") return null;
  // The declaration is meant to be line 1, but the runtime may prepend a
  // framing line to a delegated message, so scan the opening few lines
  // rather than trusting the very first one.
  for (const raw of message.split("\n", 6)) {
    const m = raw.match(/^[\s>*_#-]*CATEGORY\s*[:\u2014-]\s*\*{0,2}([^*\n]+?)\*{0,2}\s*$/i);
    if (m) return m[1].toLowerCase().slice(0, 40);
  }
  return null;
}

/** Normalized key for a category (KV keys, dedupe). */
export function categorySlug(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general";
}

// ─── Outcomes ────────────────────────────────────────────────────────────────
//
// A tool reports its own outcome in the payload rather than by throwing, so
// nothing that counts exceptions can see it. The taxonomy lives here, beside
// `actionName`, for the same reason that did: the trace store, the live rail
// and the stack diagram each used to carry a private copy of "did this work",
// and all three were wrong in the same way.
//
// The tools still write their own string literals, so nothing here breaks a
// type when one is renamed. `npm run test:outcomes` is what enforces the link:
// it reads every status literal back out of the sources and fails on any this
// file does not classify.

/**
 * The call did what it was asked to do.
 *
 * `dry_run` and `sent_to_test_inbox` are here on purpose: the deployment mode
 * decided them, not the input, and the tool did exactly what that mode asks.
 * Whether an email actually reached a vendor is answered by the outreach
 * audit (/outreach), which reads the roster, not by this taxonomy.
 */
export const SUCCESS_STATUSES = [
  "ok", "recorded", "saved", "filed", "booked", "cancelled", "sent", "no_timeline",
  "done", "skipped", "dry_run", "sent_to_test_inbox",
] as const;

/**
 * The tool worked and declined the input on purpose — a guard refusal, a
 * budget limit, or a send that policy blocked. Not a fault, but never a
 * success either: an outreach round where every send hit the daily cap must
 * not look like one where every send landed.
 */
export const REFUSED_STATUSES = ["blocked", "cap_reached"] as const;

/** The tool could not do its job. */
export const FAILED_STATUSES = [
  "search_failed", "record_failed", "not_configured", "not_found", "unavailable",
] as const;

const SUCCESS = new Set<string>(SUCCESS_STATUSES);
const REFUSED = new Set<string>(REFUSED_STATUSES);
const FAILED = new Set<string>(FAILED_STATUSES);

/** True only for a status this file has been told about. */
export function isKnownStatus(status: string): boolean {
  return SUCCESS.has(status) || REFUSED.has(status) || FAILED.has(status)
    || status.startsWith("rejected_");
}

/** True for an explicit, recognised success — never for an unknown status. */
export function isSuccessStatus(status: string): boolean {
  return SUCCESS.has(status);
}

export type ActionOutcome = "success" | "refused" | "failed";

/**
 * Read one `action.result` event as success, refusal or failure.
 *
 * Order matters. eve's `createActionResultEvent` attaches an `error` to a
 * *rejected* result as well as to a failed one — `buildActionResultError`
 * never returns undefined — so testing `data.error` first swallows every
 * approval-gate denial into "failed" and leaves `refusedActions` permanently
 * zero. The runtime's own `status` is the more specific signal, so it is read
 * before the error payload.
 */
export function actionOutcome(data: Any): ActionOutcome {
  const status = String(data?.status ?? "");
  if (status === "rejected") return "refused";
  if (status === "failed" || data?.error || data?.result?.isError) return "failed";

  const soft = String((data?.result?.output as { status?: string } | undefined)?.status ?? "");
  if (!soft) return "success";
  if (soft.startsWith("rejected_") || REFUSED.has(soft)) return "refused";
  if (FAILED.has(soft)) return "failed";
  return "success";
}

/** The tool's self-reported status, for the trace note. Bounded. */
export function actionStatus(data: Any): string {
  return String((data?.result?.output as { status?: string } | undefined)?.status ?? "").slice(0, 40);
}

// ─── Counters ────────────────────────────────────────────────────────────────

/** Older summaries predate some counters; read them as 0 rather than NaN. */
export function readCount(n: unknown): number {
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}

/**
 * How many times a tool actually did its job.
 *
 * A trace's `tools` map is folded at `actions.requested`, before the tool
 * runs, so it counts intent. A search past the budget cap is requested,
 * refused, and never reaches Tavily — reporting it as a search is how a scout
 * came to show 30 searches against a cap of 25. Every surface that reports
 * work done reads it through here.
 *
 * Typed structurally so the client bundle does not pull in the KV store.
 */
export function toolRuns(
  summary: { tools?: Record<string, number>; toolsRefused?: Record<string, number> } | null | undefined,
  name: string,
): number {
  if (!summary) return 0;
  return Math.max(0, readCount(summary.tools?.[name]) - readCount(summary.toolsRefused?.[name]));
}
