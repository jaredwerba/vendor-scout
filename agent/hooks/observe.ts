import type { HandleMessageStreamEvent } from "eve/client";
import { defineHook } from "eve/hooks";
import { recordTraceEvent } from "../lib/trace";

/**
 * Observe-only hook: after every durable stream event, fold it into that
 * session's trace summary in KV (agent/lib/trace.ts) so the app's live rail
 * and /observe can show what every agent is doing — turns, model steps, tool
 * calls, vendors recorded, tokens, cost — without a LangSmith login.
 *
 * Declared subagents inherit nothing from the root, so this file is
 * re-exported under agent/subagents/scout/hooks/ to keep every specialist in
 * the same store. `ctx.session.parent` is what links a child to its root; it
 * is the only place that lineage is available.
 *
 * A hook that throws fails the turn, so recording is wrapped and can only
 * ever warn.
 */
export default defineHook({
  events: {
    async "*"(event: HandleMessageStreamEvent, ctx) {
      try {
        await recordTraceEvent(ctx.session.id, event, ctx.session.parent ?? null);
      } catch (error) {
        console.warn("[venus/observe] hook swallowed", (error as Error)?.message ?? error);
      }
    },
  },
});
