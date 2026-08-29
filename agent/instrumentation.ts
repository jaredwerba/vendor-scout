import { registerOTel } from "@vercel/otel";
import { defineInstrumentation } from "eve/instrumentation";
import { LangSmithOTLPTraceExporter } from "langsmith/experimental/otel/exporter";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { saveLangSmithTraceId } from "./lib/trace";

/**
 * LangSmith tracing — the deep, span-level view under the app's own rail.
 *
 * eve wraps every turn in spans emitted through the AI SDK's GenAI-semconv
 * OpenTelemetry integration: `invoke_agent {model}`, `chat {model}`,
 * `execute_tool {tool}`. Two things stand between those spans and a usable
 * LangSmith project, and both are handled here:
 *
 *  1. `LangSmithOTLPTraceExporter.export()` is a no-op unless LANGSMITH_TRACING
 *     is truthy. A key alone buys nothing, so we check for both and say so
 *     loudly when only one is present.
 *  2. Because eve uses the *new* integration, our `runtimeContext` lands as
 *     `ai.settings.context.*` attributes. The exporter only rewrites the
 *     legacy `ai.telemetry.metadata.*` prefix, and its span-kind branches are
 *     gated on `ai.operationId`, which these spans do not carry. Without the
 *     transform below, every run arrives in LangSmith unlabelled and
 *     unfilterable — no session, no agent role, no span kinds.
 *
 * The transform also captures each session's OTel trace id into KV, so the
 * app can deep-link straight to the trace without querying the LangSmith API.
 */

import { modelIdFor } from "./lib/models";
const PROJECT = process.env.LANGSMITH_PROJECT ?? "venus";

const CONTEXT_PREFIX = "ai.settings.context.";

/** eve/AI-SDK span name -> the run type LangSmith should show. */
function spanKindFor(name: string): string | null {
  if (name.startsWith("chat ") || name.startsWith("generate_content")) return "llm";
  if (name.startsWith("execute_tool")) return "tool";
  if (name.startsWith("invoke_agent") || name.startsWith("ai.eve")) return "chain";
  return null;
}

const seenSessions = new Set<string>();

/** An 8-byte OTel span id as the UUID LangSmith uses for the run. */
export function langsmithRunId(spanId: string): string {
  const hex = (spanId ?? "").padStart(16, "0").slice(-16);
  return `00000000-0000-0000-${hex.slice(0, 4)}-${hex.slice(4)}`;
}

function transformExportedSpan(span: ReadableSpan): ReadableSpan {
  const attrs = span.attributes as Record<string, unknown>;

  // 1. runtimeContext -> LangSmith run metadata.
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith(CONTEXT_PREFIX)) {
      const rest = k.slice(CONTEXT_PREFIX.length);
      const target = rest.startsWith("langsmith.") ? rest : `langsmith.metadata.${rest}`;
      if (attrs[target] === undefined) attrs[target] = v as never;
    }
  }

  // 2. eve's own span attributes -> metadata, so a session is filterable
  //    even on spans the step.started hook never touched.
  const lift: Array<[string, string]> = [
    ["eve.session.id", "langsmith.metadata.session_id"],
    ["eve.turn.id", "langsmith.metadata.turn_id"],
    ["eve.step.index", "langsmith.metadata.step"],
    ["eve.channel.kind", "langsmith.metadata.channel"],
    ["eve.agent.name", "langsmith.metadata.agent"],
  ];
  for (const [from, to] of lift) {
    if (attrs[from] !== undefined && attrs[to] === undefined) attrs[to] = attrs[from] as never;
  }

  // 3. Span kind, which the built-in rules skip for these span names.
  if (attrs["langsmith.span.kind"] === undefined) {
    const kind = spanKindFor(span.name);
    if (kind) attrs["langsmith.span.kind"] = kind;
  }

  // 4. Remember which LangSmith RUN belongs to which eve session.
  //
  //    Not the OTel trace id. LangSmith derives a run id from the OTel SPAN
  //    id, zero-padded into a UUID — a real one looks like
  //    00000000-0000-0000-2c13-12a1be0cc1a4, where the last 16 hex digits are
  //    the 8-byte span id. Storing the 32-character trace id produced a link
  //    that always 404'd, and the 404 was invisible from this side because
  //    nothing here ever fetches it.
  //
  //    Only the root span (no parent) becomes the run a deep link should open.
  const sessionId = String(attrs["langsmith.metadata.session_id"] ?? "");
  const parentSpanId =
    (span as { parentSpanContext?: { spanId?: string } }).parentSpanContext?.spanId ??
    (span as { parentSpanId?: string }).parentSpanId;
  if (sessionId && !parentSpanId && !seenSessions.has(sessionId)) {
    seenSessions.add(sessionId);
    void saveLangSmithTraceId(sessionId, langsmithRunId(span.spanContext().spanId)).catch(() => {});
  }

  return span;
}

export default defineInstrumentation({
  recordInputs: true,
  recordOutputs: true,
  setup: ({ agentName }) => {
    const key = process.env.LANGSMITH_API_KEY;
    const tracing = process.env.LANGSMITH_TRACING;
    if (!key) {
      console.info("[venus/trace] LangSmith export off — set LANGSMITH_API_KEY to enable");
      return;
    }
    if (!tracing || tracing === "false" || tracing === "0") {
      // The exporter silently drops every span in this state; a dead
      // observability pipeline that looks alive is worse than none.
      console.warn(
        "[venus/trace] LANGSMITH_API_KEY is set but LANGSMITH_TRACING is not — " +
          "the LangSmith exporter drops every span. Set LANGSMITH_TRACING=true.",
      );
    }
    registerOTel({
      serviceName: agentName,
      traceExporter: new LangSmithOTLPTraceExporter({ projectName: PROJECT, transformExportedSpan }),
    });
    console.info(`[venus/trace] LangSmith export on → project ${PROJECT}`);
  },
  events: {
    "step.started"(input) {
      const parent = input.session.parent?.sessionId;
      return {
        runtimeContext: {
          "langsmith.metadata.session_id": input.session.id,
          "langsmith.metadata.root_session_id": input.session.parent?.rootSessionId ?? input.session.id,
          "langsmith.metadata.parent_session": parent ?? "",
          "langsmith.metadata.role": parent ? "specialist" : "root",
          "langsmith.metadata.turn_id": input.turn.id,
          "langsmith.metadata.turn_sequence": input.turn.sequence,
          "langsmith.metadata.step": input.step.index,
          "langsmith.metadata.channel": input.channel.kind ?? "unknown",
          "langsmith.metadata.provider": "nebius-token-factory",
          // Report the model that actually served this session's role, so a
          // LangSmith trace never claims the planner's model for a scout run.
          "langsmith.metadata.model": modelIdFor(parent ? "scout" : "planner"),
        },
      };
    },
  },
});
