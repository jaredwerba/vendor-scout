import { registerOTel } from "@vercel/otel";
import { defineInstrumentation } from "eve/instrumentation";
import { LangSmithOTLPTraceExporter } from "langsmith/experimental/otel/exporter";

/**
 * LangSmith tracing. eve wraps every turn in an `ai.eve.turn` span with
 * `ai.streamText` / `ai.toolCall` children (model calls and tool executions),
 * and this file decides where those spans go. With LANGSMITH_API_KEY set they
 * are exported to LangSmith (project LANGSMITH_PROJECT, default "venus") via
 * OTLP; without it, telemetry stays local and nothing leaves the box.
 *
 * The step.started callback stamps each model call with session/turn/step
 * and the Token Factory model so LangSmith can filter and group runs.
 */
const MODEL = (process.env.NEBIUS_MODEL ?? "").trim() || "Qwen/Qwen3-235B-A22B-Instruct-2507";

export default defineInstrumentation({
  recordInputs: true,
  recordOutputs: true,
  setup: ({ agentName }) => {
    if (!process.env.LANGSMITH_API_KEY) {
      console.info("[venus/trace] LangSmith export off — set LANGSMITH_API_KEY to enable");
      return;
    }
    registerOTel({
      serviceName: agentName,
      traceExporter: new LangSmithOTLPTraceExporter({
        projectName: process.env.LANGSMITH_PROJECT ?? "venus",
      }),
    });
    console.info(`[venus/trace] LangSmith export on → project ${process.env.LANGSMITH_PROJECT ?? "venus"}`);
  },
  events: {
    "step.started"(input) {
      return {
        runtimeContext: {
          "langsmith.metadata.session_id": input.session.id,
          "langsmith.metadata.turn_id": input.turn.id,
          "langsmith.metadata.turn_sequence": input.turn.sequence,
          "langsmith.metadata.step": input.step.index,
          "langsmith.metadata.channel": input.channel.kind ?? "unknown",
          "langsmith.metadata.provider": "nebius-token-factory",
          "langsmith.metadata.model": MODEL,
          "langsmith.metadata.parent_session": input.session.parent?.sessionId ?? "",
        },
      };
    },
  },
});
