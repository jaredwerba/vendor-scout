import { defineTool } from "eve/tools";
import { z } from "zod";
import { listMilestones, setMilestoneStatus, timelineConfigured } from "../lib/timeline";

/**
 * The couple did a thing (or decided to skip it) — keep the Countdown true.
 * No approval: it records their own progress.
 */
export default defineTool({
  description:
    "Mark a Countdown milestone done or skipped when the couple says so ('we sent the " +
    "save-the-dates!', 'skip the videographer stuff'). Fuzzy title match. Celebrate the dones.",
  inputSchema: z.object({
    milestone_title: z.string().min(3).max(120).describe("The milestone, roughly as titled."),
    outcome: z.enum(["done", "skipped"]).default("done"),
  }),
  async execute({ milestone_title, outcome }) {
    if (!timelineConfigured()) {
      return { status: "not_configured", note: "Timeline store isn't set up." };
    }
    const needle = milestone_title.toLowerCase();
    const all = await listMilestones();
    const match =
      all.find((m) => m.title.toLowerCase() === needle) ??
      all.find(
        (m) =>
          m.title.toLowerCase().includes(needle) || needle.includes(m.title.toLowerCase()),
      ) ??
      all.find((m) =>
        needle
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .some((w) => m.title.toLowerCase().includes(w)),
      );
    if (!match) {
      return {
        status: "not_found",
        note: `No milestone matches "${milestone_title}". Check the Countdown with check_timeline.`,
      };
    }
    const updated = await setMilestoneStatus(match.id, outcome === "done" ? "done" : "skipped");
    return {
      status: outcome,
      milestone: updated?.title,
      remaining: all.filter((m) => m.status === "upcoming" && m.id !== match.id).length,
    };
  },
});
