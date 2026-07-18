import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  daysUntil,
  getTimelineMeta,
  listMilestones,
  timelineConfigured,
} from "../lib/timeline";

/** Read the Countdown for status conversations. No approval needed. */
export default defineTool({
  description:
    "Read the couple's wedding Countdown: days to go, what's due soon, what's done, what's " +
    "left. Use when they ask what's next / how planning is going, alongside " +
    "check_outreach_status.",
  inputSchema: z.object({
    horizon_days: z
      .number()
      .int()
      .min(7)
      .max(365)
      .optional()
      .describe("Only list milestones due within this many days (default: everything)."),
  }),
  async execute({ horizon_days }) {
    if (!timelineConfigured()) {
      return { status: "not_configured", note: "Timeline store isn't set up." };
    }
    const meta = await getTimelineMeta();
    if (!meta) {
      return {
        status: "no_timeline",
        note: "No Countdown yet — generate one with generate_wedding_timeline once the date is set.",
      };
    }
    let milestones = await listMilestones();
    if (horizon_days) {
      const horizon = new Date(Date.now() + horizon_days * 864e5).toISOString().slice(0, 10);
      milestones = milestones.filter((m) => m.due_date <= horizon || m.status === "upcoming");
    }
    return {
      status: "ok",
      wedding_date: meta.wedding_date,
      days_to_go: daysUntil(meta.wedding_date),
      done: milestones.filter((m) => m.status === "done").length,
      upcoming: milestones
        .filter((m) => m.status === "upcoming")
        .map((m) => ({
          title: m.title,
          due: m.due_date,
          days_out: daysUntil(m.due_date),
          category: m.category,
          detail: m.detail,
        })),
    };
  },
});
