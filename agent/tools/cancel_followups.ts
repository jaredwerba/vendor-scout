import { defineTool } from "eve/tools";
import { z } from "zod";
import { cancelFollowups, listRecords, rosterConfigured } from "../lib/roster";

/**
 * "Stop chasing X." Revokes the automatic follow-up authorization for a
 * vendor. No approval gate — it only ever REDUCES what the agent may do.
 */
export default defineTool({
  description:
    "Cancel automatic follow-up nudges for a vendor (the couple says e.g. 'stop chasing the " +
    "florist'). Takes the outreach_id from check_outreach_status, or a vendor name to match.",
  inputSchema: z.object({
    outreach_id: z.string().optional().describe("Exact outreach id, if known."),
    vendor_name: z.string().optional().describe("Vendor name to match when the id is unknown."),
  }),
  async execute({ outreach_id, vendor_name }) {
    if (!rosterConfigured()) {
      return { status: "not_configured", note: "Outreach tracking store is not set up yet." };
    }
    let id = outreach_id ?? null;
    if (!id && vendor_name) {
      const f = vendor_name.toLowerCase();
      const match = (await listRecords()).find((r) =>
        r.vendor_name.toLowerCase().includes(f),
      );
      id = match?.id ?? null;
    }
    if (!id) {
      return { status: "not_found", note: "No matching outreach record. Run check_outreach_status first." };
    }
    const rec = await cancelFollowups(id);
    if (!rec) return { status: "not_found", note: `No record with id ${id}.` };
    return {
      status: "cancelled",
      vendor: rec.vendor_name,
      note: `Automatic follow-ups for ${rec.vendor_name} are stopped. Already-sent emails are unaffected.`,
    };
  },
});
