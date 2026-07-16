import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

/**
 * Send one vendor inquiry email — the agent's first real-world side effect.
 *
 * Safety model (layered, so no single mistake can email a vendor):
 *  1. `approval: always()` — every call durably pauses for a human yes/no.
 *     The model cannot bypass this; it is enforced by the harness.
 *  2. OUTREACH_MODE env decides what "send" means:
 *       - "dry_run" (DEFAULT, also any unset/unknown value): no network at all;
 *         returns what would have been sent.
 *       - "test": delivers via Resend, but ONLY to OUTREACH_TEST_INBOX —
 *         the vendor address is never used as a recipient.
 *       - "live": delivers to the vendor. Requires RESEND_API_KEY and
 *         OUTREACH_FROM to be configured deliberately.
 *  3. The model must supply a vendor email it actually found published;
 *     instructions forbid guessing addresses. Contact-form-only vendors are
 *     handled by the caller as copy/paste drafts, not by this tool.
 */

const MODE = (process.env.OUTREACH_MODE ?? "dry_run").toLowerCase();
const RESEND_KEY = process.env.RESEND_API_KEY;
const TEST_INBOX = process.env.OUTREACH_TEST_INBOX;
// Resend's shared onboarding sender works without domain verification and can
// only deliver to the account owner's own inbox — a safe default for test mode.
const FROM = process.env.OUTREACH_FROM ?? "Vendor Scout <onboarding@resend.dev>";

async function deliver(to: string, subject: string, body: string, replyTo?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      text: body,
      ...(replyTo ? { reply_to: [replyTo] } : {}),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) {
    throw new Error(`Resend rejected the email (${res.status}): ${json.message ?? "unknown error"}`);
  }
  return json.id ?? "unknown";
}

export default defineTool({
  description:
    "Send one wedding-vendor inquiry email on the couple's behalf. Requires human approval on " +
    "every call. Depending on server configuration this may be a dry run (nothing sent), a test " +
    "delivery to the couple's own inbox, or a live send. Always report the returned status to the " +
    "couple honestly — never claim an email was delivered unless status is 'sent'.",
  inputSchema: z.object({
    vendor_name: z.string().min(1).max(120).describe("Vendor business name, for the record."),
    vendor_email: z
      .string()
      .email()
      .describe("The inquiry email address published by the vendor. Never guess or invent one."),
    subject: z.string().min(4).max(150).describe("Plain, honest subject line."),
    body: z
      .string()
      .min(40)
      .max(3000)
      .describe("The full inquiry text, personalized from the couple's brief."),
    reply_to: z
      .string()
      .email()
      .optional()
      .describe("The couple's email for vendor replies, if they provided one."),
  }),
  approval: always(),
  async execute({ vendor_name, vendor_email, subject, body, reply_to }) {
    if (MODE === "live") {
      if (!RESEND_KEY) {
        return {
          status: "not_configured",
          note: "OUTREACH_MODE=live but RESEND_API_KEY is missing. Nothing was sent.",
        };
      }
      const id = await deliver(vendor_email, subject, body, reply_to);
      return { status: "sent", to: vendor_email, vendor_name, provider_id: id };
    }

    if (MODE === "test") {
      if (!RESEND_KEY || !TEST_INBOX) {
        return {
          status: "not_configured",
          note:
            "OUTREACH_MODE=test needs RESEND_API_KEY and OUTREACH_TEST_INBOX. Nothing was sent.",
        };
      }
      const id = await deliver(
        TEST_INBOX,
        `[TEST — would go to ${vendor_name} <${vendor_email}>] ${subject}`,
        body,
        reply_to,
      );
      return {
        status: "sent_to_test_inbox",
        to: TEST_INBOX,
        would_have_gone_to: vendor_email,
        vendor_name,
        provider_id: id,
      };
    }

    // Default: dry run. No network. Safe on a zero-config deploy.
    return {
      status: "dry_run",
      note: "Outreach is in dry-run mode: NOTHING was sent. This is what would have gone out.",
      would_send: { to: vendor_email, vendor_name, subject, body, reply_to: reply_to ?? null },
    };
  },
});
