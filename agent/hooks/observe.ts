import type { HandleMessageStreamEvent } from "eve/client";
import { defineHook } from "eve/hooks";
import { recordTraceEvent } from "../lib/trace";

/**
 * Observe-only hook: after every durable stream event, fold it into the
 * session's trace summary in KV (agent/lib/trace.ts) so /observe can show
 * what Venus did — turns, model steps, tool calls, specialists, tokens —
 * across every session, without a LangSmith login. A hook that throws
 * fails the turn, so recording is wrapped and can only ever log.
 */
export default defineHook({
  events: {
    async "*"(event: HandleMessageStreamEvent, ctx) {
      try {
        await recordTraceEvent(ctx.session.id, event);
      } catch (error) {
        console.warn("[venus/observe] hook swallowed", (error as Error)?.message ?? error);
      }
    },
  },
});
