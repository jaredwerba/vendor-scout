import { defineTool } from "eve/tools";
import { z } from "zod";
import { listRecords, rosterConfigured } from "../lib/roster";

/** Read-only view of the outreach roster for the couple's chat. No approval needed. */
export default defineTool({
  description:
    "Check the status of all vendor outreach: who was contacted, who replied (with their " +
    "message), who declined, who is being auto-followed-up and when. Use whenever the couple " +
    "asks how outreach is going, or before proposing new sends.",
  inputSchema: z.object({
    vendor_name_filter: z
      .string()
      .optional()
      .describe("Optionally narrow to vendors whose name contains this text."),
  }),
  async execute({ vendor_name_filter }) {
    if (!rosterConfigured()) {
      return { status: "not_configured", note: "Outreach tracking store is not set up yet." };
    }
    let records = await listRecords();
    if (vendor_name_filter) {
      const f = vendor_name_filter.toLowerCase();
      records = records.filter((r) => r.vendor_name.toLowerCase().includes(f));
    }
    return {
      status: "ok",
      count: records.length,
      outreach: records.map((r) => ({
        outreach_id: r.id,
        vendor: r.vendor_name,
        email: r.vendor_email,
        status: r.status,
        sent_at: r.sent_at,
        followups_authorized: r.followups_authorized,
        nudges_sent: r.nudge_count,
        next_followup_at: r.next_followup_at,
        thread: r.thread.map((t) => ({
          who: t.who,
          when: t.when,
          preview: t.text.slice(0, 400),
        })),
      })),
    };
  },
});
