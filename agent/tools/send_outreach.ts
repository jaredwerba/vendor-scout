import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  MAX_EMAILS_PER_VENDOR,
  MAX_NUDGES,
  countDailySend,
  countVendorEmail,
  getRecord,
  listRecords,
  newRecord,
  putRecord,
  rosterConfigured,
  scheduleNextFollowup,
  underDailyCap,
  vendorEmailCount,
} from "../lib/roster";
import { OUTREACH_MODE, replyAddressFor, sendModeAware } from "../lib/resend";

/**
 * Send one vendor inquiry — the agent's real-world side effect.
 *
 * Layered safety:
 *  1. Approval POLICY (not a blanket always()): human sessions pause for a
 *     tap on every call; unattended app-principal sessions can never park an
 *     unanswerable prompt — they resolve to approved/denied against the
 *     roster's pre-authorization and caps. (Scheduled nudges normally bypass
 *     this tool entirely — the sweep sends deterministically — so the app
 *     branch is defense-in-depth.)
 *  2. execute() re-checks state at send time: approval is a gate, not
 *     authorization. A send approved before a long park must not fire if the
 *     vendor has since replied or declined, or a cap has been hit.
 *  3. OUTREACH_MODE (lib/resend.ts): dry_run default / test-inbox / live.
 *  4. Explicit `authorize_followups` in the input schema so the follow-up
 *     consent is VISIBLE in the approval card the couple taps.
 */

const inputSchema = z.object({
  vendor_name: z.string().min(1).max(120).describe("Vendor business name."),
  vendor_email: z
    .string()
    .email()
    .describe("The inquiry address published by the vendor. Never guess or invent one."),
  subject: z.string().min(4).max(150).describe("Plain, honest subject line."),
  body: z
    .string()
    .min(40)
    .max(3000)
    .describe("The full inquiry text, personalized from the couple's brief."),
  couple_summary: z
    .string()
    .min(10)
    .max(300)
    .describe(
      "One-line context for automatic follow-ups, e.g. 'Alex & Sam, fall 2027 woodland wedding, ~100 guests, light & airy photography'.",
    ),
  authorize_followups: z
    .boolean()
    .default(true)
    .describe(
      "Automatic follow-ups (up to 2 nudges, a few days apart) if the vendor doesn't reply. " +
        "ALWAYS true by product policy — never ask the couple about this. They can stop any " +
        "vendor's follow-ups later with cancel_followups.",
    ),
});

type OutreachInput = z.infer<typeof inputSchema>;

const isAppPrincipal = (auth: {
  authenticator?: string;
  principalId?: string;
  principalType?: string;
} | null) =>
  auth?.authenticator === "app" &&
  auth?.principalId === "eve:app" &&
  auth?.principalType === "runtime";

export default defineTool({
  description:
    "Send one wedding-vendor inquiry email on the couple's behalf. Human-initiated calls always " +
    "pause for the couple's approval; the approval card shows exactly what will be sent and " +
    "whether automatic follow-ups are authorized. Depending on server configuration the send is " +
    "a dry run (nothing delivered), a test delivery to the couple's own inbox, or live. Always " +
    "report the returned status honestly — only status 'sent' means a vendor received email.",
  inputSchema,
  approval: async ({ session, toolInput }) => {
    const auth = session.auth.current;
    // OWNER'S CHOICE (2026-07-16): human sessions send WITHOUT an approval
    // card. Consent happens conversationally — instructions require the
    // couple's go-ahead in chat before this tool is called — and the hard
    // caps below (active-duplicate block, per-vendor lifetime cap, daily
    // cap) bound the blast radius. Flip back to "user-approval" to restore
    // per-send taps.
    if (!isAppPrincipal(auth ?? null)) return "not-applicable";

    // Unattended (schedule-started) sessions must never park for approval —
    // nobody is attached to answer. Decide from the roster, conservatively.
    if (!rosterConfigured()) {
      return { type: "denied", reason: "No roster store; unattended sends are not allowed." };
    }
    const input = toolInput as OutreachInput | undefined;
    if (!input?.vendor_email) {
      return { type: "denied", reason: "Missing vendor email on an unattended send." };
    }
    const all = await listRecords();
    const rec = all.find(
      (r) => r.vendor_email.toLowerCase() === input.vendor_email.toLowerCase(),
    );
    if (!rec) return { type: "denied", reason: "No roster record for this vendor." };
    if (rec.status === "declined" || rec.status === "replied") {
      return { type: "denied", reason: "Vendor already responded; do not contact again." };
    }
    if (!rec.followups_authorized) {
      return { type: "denied", reason: "Follow-ups were not authorized by the couple." };
    }
    if (rec.nudge_count >= MAX_NUDGES) {
      return { type: "denied", reason: "Follow-up cap reached." };
    }
    return { type: "approved", reason: "Pre-authorized follow-up within caps." };
  },
  async execute(input) {
    const { vendor_name, vendor_email, subject, body, couple_summary, authorize_followups } =
      input;

    // --- execute-time re-checks (approval is a gate, not authorization) ---
    if (rosterConfigured()) {
      const all = await listRecords();
      const existing = all.find(
        (r) => r.vendor_email.toLowerCase() === vendor_email.toLowerCase(),
      );
      if (existing && (existing.status === "declined" || existing.status === "replied")) {
        return {
          status: "blocked",
          note: `${vendor_name} has already responded (${existing.status}). Not sending — check the thread with check_outreach_status instead.`,
          outreach_id: existing.id,
        };
      }
      // Block duplicate ACTIVE campaigns: one live outreach per vendor.
      // (Found in the wild: the same venue got two initial inquiries with two
      // independent nudge schedules on day one of live mode.)
      if (
        existing &&
        (existing.status === "sent" ||
          existing.status === "nudged_1" ||
          existing.status === "nudged_2")
      ) {
        return {
          status: "blocked",
          note: `${vendor_name} already has an active outreach (${existing.id}, status ${existing.status}) — automatic follow-ups will chase them. Not sending a duplicate.`,
          outreach_id: existing.id,
        };
      }
      if ((await vendorEmailCount(vendor_email)) >= MAX_EMAILS_PER_VENDOR) {
        return {
          status: "blocked",
          note: `Cap reached: ${vendor_name} has already received ${MAX_EMAILS_PER_VENDOR} emails from us. Not sending.`,
        };
      }
      if (!(await underDailyCap())) {
        return {
          status: "blocked",
          note: "Daily outreach cap reached — try again tomorrow. Nothing was sent.",
        };
      }
    }

    // --- create the roster record first (memory precedes action) ---
    let record = null;
    if (rosterConfigured()) {
      record = newRecord({
        vendor_name,
        vendor_email,
        subject,
        couple_summary,
        followups_authorized: authorize_followups,
        reply_address: null,
      });
    }
    // Replies go to the AGENT's receiving address (plus-addressed per
    // outreach) when inbound email is configured. Until it is, fall back to
    // the couple's own inbox — a live send must NEVER go out with no usable
    // reply-to (vendor replies would bounce off the send-only from-address).
    const replyTo =
      (record ? replyAddressFor(record.id) : null) ??
      process.env.COUPLE_NOTIFY_EMAIL ??
      null;
    if (record) record.reply_address = replyTo;

    // --- send (mode-aware) ---
    const outcome = await sendModeAware({
      vendorEmail: vendor_email,
      vendorName: vendor_name,
      subject,
      body,
      replyTo,
      idempotencyKey: record ? `initial:${record.id}` : `initial:${vendor_email}:${subject}`,
    });

    // --- record what actually happened ---
    if (record) {
      record.thread.push({
        who: "agent",
        when: new Date().toISOString(),
        subject,
        text: body,
      });
      if (outcome.status === "sent" || outcome.status === "sent_to_test_inbox") {
        record.status = "sent";
        record.sent_at = new Date().toISOString();
        // Track the provider message id so bounce/complaint events can find us.
        record.provider_ids = [...(record.provider_ids ?? []), outcome.provider_id];
        scheduleNextFollowup(record);
        await countDailySend();
        await countVendorEmail(vendor_email);
      }
      await putRecord(record);
    }

    return {
      ...outcome,
      outreach_id: record?.id ?? null,
      followups: record
        ? record.followups_authorized
          ? `authorized: up to ${MAX_NUDGES} nudges, next around ${record.next_followup_at ?? "n/a"} (cancel anytime with cancel_followups)`
          : "not authorized"
        : "roster store not configured — follow-up tracking disabled",
      mode: OUTREACH_MODE,
    };
  },
});
