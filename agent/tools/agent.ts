import { disableTool } from "eve/tools";

/**
 * Disables eve's built-in `agent` tool.
 *
 * The built-in delegates to a *copy of the root agent*: same instructions,
 * same tools — including `send_outreach`. That is exactly the capability the
 * scout subagent exists to remove, and a live run showed Venus reaching for
 * both (10 `scout` calls and 3 `agent` calls in one session), which quietly
 * put research children back in front of the send button.
 *
 * An authored root tool takes priority over the built-in, so this file makes
 * `scout` (agent/subagents/scout) the only way to delegate: a researcher with
 * no ability to contact anyone.
 */
export default disableTool();
