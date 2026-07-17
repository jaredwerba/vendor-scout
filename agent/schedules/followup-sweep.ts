import { defineSchedule } from "eve/schedules";
import { replyAddressFor, sendModeAware } from "../lib/resend";
import {
  claimDueFollowups,
  completeNudge,
  countDailySend,
  countVendorEmail,
  releaseNudge,
  rosterConfigured,
  underDailyCap,
  type OutreachRecord,
} from "../lib/roster";

/**
 * The agent's alarm clock: once a day (Vercel Cron, UTC, ±59min on Hobby),
 * chase vendors who haven't replied — IF the couple pre-authorized follow-ups
 * on the approval card, and only within hard caps.
 *
 * Deterministic by design: no model call, no approval needed (approval is a
 * property of tools; this handler sends directly through lib/resend). Records
 * are claimed with an atomic lease (dispatch is at-least-once) and sends carry
 * idempotency keys, so a crashed/retried sweep can't double-email a vendor.
 * The moment a vendor replies or declines, the webhook clears next_followup_at
 * and this sweep never touches them again.
 */

function renderNudge(rec: OutreachRecord): string {
  return [
    `Hi ${rec.vendor_name} team,`,
    "",
    `Just floating our inquiry back to the top of your inbox — we reached out a few days ago about ${rec.couple_summary}.`,
    "We know this is a busy season! If you're booked for our window, a quick no is completely fine and appreciated.",
    "",
    "Thanks so much,",
    "Sent by Venus, wedding planning, on behalf of the couple — just reply to this email and it reaches them.",
  ].join("\n");
}

export default defineSchedule({
  cron: "0 14 * * *",
  run({ waitUntil }) {
    waitUntil(
      (async () => {
        if (!rosterConfigured()) return;
        const due = await claimDueFollowups(10);
        for (const rec of due) {
          if (!(await underDailyCap())) {
            await releaseNudge(rec);
            continue; // try again tomorrow
          }
          try {
            const outcome = await sendModeAware({
              vendorEmail: rec.vendor_email,
              vendorName: rec.vendor_name,
              subject: `Re: ${rec.subject}`,
              body: renderNudge(rec),
              replyTo:
                rec.reply_address ??
                replyAddressFor(rec.id) ??
                process.env.COUPLE_NOTIFY_EMAIL ??
                null,
              idempotencyKey: `nudge:${rec.id}:${rec.nudge_count + 1}`,
            });
            if (outcome.status === "sent" || outcome.status === "sent_to_test_inbox") {
              // Nudges count against the same caps as initial sends —
              // otherwise "3 emails per vendor" and the daily cap only
              // constrain half the traffic.
              rec.provider_ids = [...(rec.provider_ids ?? []), outcome.provider_id];
              await countDailySend();
              await countVendorEmail(rec.vendor_email);
              await completeNudge(rec);
            } else {
              // dry_run / not_configured: don't consume the nudge budget
              await releaseNudge(rec);
            }
          } catch {
            await releaseNudge(rec); // picked up on the next daily tick
          }
        }
      })(),
    );
  },
});
