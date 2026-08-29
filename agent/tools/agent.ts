import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Shadows eve's built-in `agent` tool so it can never be used.
 *
 * The built-in delegates to a *copy of the root agent*: same instructions,
 * same tools — including `send_outreach`. That is exactly the capability the
 * scout subagent exists to remove, and a live production run showed Venus
 * reaching for both paths in one session (10 `scout` calls and 3 `agent`
 * calls), quietly putting research children back in front of the send button.
 *
 * `disableTool()` is not available here — it only covers eve's authored
 * framework tools — but an authored root tool takes priority over the
 * built-in, so this refusal is what the model gets instead. Research and
 * outreach never share a context.
 */
export default defineTool({
  description:
    "DEPRECATED — do not call. Use `scout` to delegate research. This tool does nothing.",
  inputSchema: z.object({
    message: z.string().optional(),
  }),
  execute() {
    return {
      status: "unavailable",
      note:
        "Generic delegation is disabled in this agent. Use the `scout` tool for research: it " +
        "is a specialist with its own search budget that records each vendor as it finds one, " +
        "and it cannot contact anyone. Re-issue this as a `scout` call with `CATEGORY: <category>` " +
        "on the first line.",
    };
  },
});
