import { defineTool } from "eve/tools";
import { z } from "zod";
import { classifyReply } from "../lib/classify";
import { listRecords, recordReply, rosterConfigured } from "../lib/roster";

/**
 * The couple pastes (or relays) a vendor's reply that arrived in their own
 * inbox — file it properly: classify it, update the roster, stop the
 * follow-up chase, and hand Venus the understanding to discuss. No approval:
 * it's data entry about mail the couple already received.
 */
export default defineTool({
  description:
    "File a vendor reply the couple received directly (pasted or relayed in chat). Finds the " +
    "outreach record, understands the reply (availability, pricing, questions), updates the " +
    "roster, and stops automatic follow-ups for that vendor. Returns the structured " +
    "understanding — use it to update the couple's plan in the same breath.",
  inputSchema: z.object({
    vendor_name: z
      .string()
      .min(2)
      .max(120)
      .describe("The vendor who replied (name as used in outreach; fuzzy match ok)."),
    reply_text: z.string().min(10).max(8000).describe("The vendor's reply, pasted verbatim."),
  }),
  async execute({ vendor_name, reply_text }) {
    if (!rosterConfigured()) {
      return { status: "not_configured", note: "Outreach tracking store is not set up." };
    }
    const needle = vendor_name.toLowerCase();
    const all = await listRecords();
    const rec =
      all.find((r) => r.vendor_name.toLowerCase() === needle) ??
      all.find(
        (r) =>
          r.vendor_name.toLowerCase().includes(needle) ||
          needle.includes(r.vendor_name.toLowerCase()),
      );
    if (!rec) {
      return {
        status: "not_found",
        note: `No outreach record matches "${vendor_name}". Run check_outreach_status to see who we've contacted.`,
      };
    }
    const { intel, via } = await classifyReply({
      vendorName: rec.vendor_name,
      replyText: reply_text,
      originalSubject: rec.subject,
    });
    const updated = await recordReply(
      rec.id,
      { from: "(pasted by couple)", text: reply_text },
      { ...intel, via },
    );
    return {
      status: "filed",
      outreach_id: rec.id,
      vendor: rec.vendor_name,
      new_status: updated?.status,
      understanding: intel,
      followups: "stopped automatically",
    };
  },
});
