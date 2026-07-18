import { defineTool } from "eve/tools";
import { z } from "zod";
import { saveTimeline, timelineConfigured } from "../lib/timeline";

/**
 * Persist the Countdown: Venus composes the milestones (she knows the date,
 * the venue situation, the style, and what's already booked); this tool
 * stores them and switches on the proactive check-ins. Regenerating replaces
 * the whole timeline. No approval — it only writes the couple's own plan.
 */
export default defineTool({
  description:
    "Save the couple's wedding Countdown: a complete dated milestone plan from today to the " +
    "wedding day. Call after execution begins (or whenever the date locks / they ask for a " +
    "plan). Compose 15-25 milestones YOURSELF from their real situation: skip what's already " +
    "booked, respect their style and venue type, space work sensibly, include the legal " +
    "must-dos (license window!) and at least two purely joyful ones. Regenerating replaces " +
    "the previous timeline. Venus checks in by email as milestones come due.",
  inputSchema: z.object({
    wedding_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The wedding date, YYYY-MM-DD."),
    couple_email: z
      .string()
      .email()
      .optional()
      .describe("Where check-ins go (from their opening message). Always pass when known."),
    couple_names: z.string().max(80).optional().describe("First name(s) for warm check-ins."),
    milestones: z
      .array(
        z.object({
          title: z.string().min(3).max(90).describe("Short, human, e.g. 'Book your caterer'."),
          detail: z
            .string()
            .min(10)
            .max(280)
            .describe("Why now + the concrete next step, in Venus's warm voice."),
          due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD."),
          category: z
            .enum(["venue", "attire", "stationery", "food", "legal", "beauty", "logistics", "joy"])
            .describe("Bucket for the dashboard."),
        }),
      )
      .min(8)
      .max(30),
  }),
  async execute({ wedding_date, couple_email, couple_names, milestones }) {
    if (!timelineConfigured()) {
      return { status: "not_configured", note: "Timeline store isn't set up." };
    }
    const { count } = await saveTimeline(
      {
        wedding_date,
        couple_email: couple_email ?? null,
        couple_names: couple_names ?? null,
      },
      milestones,
    );
    return {
      status: "saved",
      milestones: count,
      wedding_date,
      dashboard: "/my-wedding",
      note: "Countdown live — I'll check in as each milestone approaches.",
    };
  },
});
