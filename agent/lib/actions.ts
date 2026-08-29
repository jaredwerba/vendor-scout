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
