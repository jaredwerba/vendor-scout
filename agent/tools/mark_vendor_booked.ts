import { defineTool } from "eve/tools";
import { z } from "zod";
import { getRecord, listRecords, putRecord, rosterConfigured } from "../lib/roster";

/**
 * The couple made a decision — lock it in. Booked vendors anchor the
 * My Wedding dashboard: what's secured, at what price, and what's left.
 * No approval: it records a decision the couple just told us about.
 */
export default defineTool({
  description:
    "Mark a vendor as BOOKED when the couple confirms they've chosen/signed with them (e.g. " +
    "'we booked Smolak!'). Records the agreed price and any note, stops all follow-ups, and " +
    "shows the vendor as secured on their My Wedding dashboard (/my-wedding).",
  inputSchema: z.object({
    vendor_name: z.string().min(2).max(120).describe("The vendor they booked (fuzzy match ok)."),
    agreed_price: z
      .string()
      .optional()
      .describe("The agreed price if the couple mentioned it, e.g. '$12,400 all-inclusive'."),
    note: z.string().max(300).optional().describe("Anything worth remembering about the booking."),
  }),
  async execute({ vendor_name, agreed_price, note }) {
    if (!rosterConfigured()) {
      return { status: "not_configured", note: "Outreach tracking store is not set up." };
    }
    const needle = vendor_name.toLowerCase();
    const all = await listRecords();
    const match =
      all.find((r) => r.vendor_name.toLowerCase() === needle) ??
      all.find(
        (r) =>
          r.vendor_name.toLowerCase().includes(needle) ||
          needle.includes(r.vendor_name.toLowerCase()),
      );
    if (!match) {
      return {
        status: "not_found",
        note: `No outreach record matches "${vendor_name}" — I can only book vendors we've been in touch with. Check check_outreach_status.`,
      };
    }
    const rec = await getRecord(match.id);
    if (!rec) return { status: "not_found", note: "Record vanished mid-update." };
    rec.status = "booked";
    rec.followups_authorized = false;
    rec.next_followup_at = null;
    rec.booked = {
      at: new Date().toISOString(),
      price: agreed_price ?? null,
      note: note ?? null,
    };
    rec.thread.push({
      who: "agent",
      when: new Date().toISOString(),
      text: `(BOOKED${agreed_price ? ` — ${agreed_price}` : ""}${note ? ` — ${note}` : ""} 🎉)`,
    });
    await putRecord(rec);
    return {
      status: "booked",
      vendor: rec.vendor_name,
      price: agreed_price ?? "not recorded",
      dashboard: "/my-wedding",
    };
  },
});
