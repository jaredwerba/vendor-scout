/**
 * All email plumbing in one place, shared by the send_outreach tool, the
 * followup-sweep schedule, and the inbound-email webhook.
 *
 * OUTREACH_MODE decides what "send" means everywhere:
 *  - "dry_run" (default): no network; callers report what would have gone out.
 *  - "test":  deliver ONLY to OUTREACH_TEST_INBOX, subject-prefixed with the
 *             real intended recipient. Vendors are never contacted.
 *  - "live":  deliver to the vendor. Requires a verified domain + explicit env.
 */

export const OUTREACH_MODE = (process.env.OUTREACH_MODE ?? "dry_run").toLowerCase();
const RESEND_KEY = process.env.RESEND_API_KEY;
const TEST_INBOX = process.env.OUTREACH_TEST_INBOX;
const FROM = process.env.OUTREACH_FROM ?? "Vendor Scout <onboarding@resend.dev>";
// The agent's own receiving address (plus-addressing appends the outreach id).
const REPLY_ADDRESS = process.env.OUTREACH_REPLY_ADDRESS;
const NOTIFY_EMAIL = process.env.COUPLE_NOTIFY_EMAIL;

export const resendConfigured = () => Boolean(RESEND_KEY);

/** replies+{outreachId}@... so inbound webhooks self-correlate to their record. */
export function replyAddressFor(outreachId: string): string | null {
  if (!REPLY_ADDRESS) return null;
  const [local, domain] = REPLY_ADDRESS.split("@");
  if (!domain) return null;
  return `${local.split("+")[0]}+${outreachId}@${domain}`;
}

async function resendPost(
  path: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ id?: string }> {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_KEY}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(`Resend rejected (${res.status}): ${json.message ?? "unknown"}`);
  }
  return json;
}

export type SendOutcome =
  | { status: "dry_run"; would_send: Record<string, unknown> }
  | { status: "sent_to_test_inbox"; to: string; would_have_gone_to: string; provider_id: string }
  | { status: "sent"; to: string; provider_id: string }
  | { status: "not_configured"; note: string };

/** Mode-aware send used for BOTH initial inquiries and automatic nudges. */
export async function sendModeAware(args: {
  vendorEmail: string;
  vendorName: string;
  subject: string;
  body: string;
  replyTo: string | null;
  idempotencyKey: string;
}): Promise<SendOutcome> {
  const { vendorEmail, vendorName, subject, body, replyTo, idempotencyKey } = args;

  if (OUTREACH_MODE === "live") {
    if (!RESEND_KEY) {
      return { status: "not_configured", note: "OUTREACH_MODE=live but RESEND_API_KEY missing." };
    }
    const r = await resendPost(
      "/emails",
      {
        from: FROM,
        to: [vendorEmail],
        subject,
        text: body,
        ...(replyTo ? { reply_to: [replyTo] } : {}),
      },
      idempotencyKey,
    );
    return { status: "sent", to: vendorEmail, provider_id: r.id ?? "unknown" };
  }

  if (OUTREACH_MODE === "test") {
    if (!RESEND_KEY || !TEST_INBOX) {
      return {
        status: "not_configured",
        note: "OUTREACH_MODE=test needs RESEND_API_KEY and OUTREACH_TEST_INBOX.",
      };
    }
    const r = await resendPost(
      "/emails",
      {
        from: FROM,
        to: [TEST_INBOX],
        subject: `[TEST — would go to ${vendorName} <${vendorEmail}>] ${subject}`,
        text: body,
        ...(replyTo ? { reply_to: [replyTo] } : {}),
      },
      idempotencyKey,
    );
    return {
      status: "sent_to_test_inbox",
      to: TEST_INBOX,
      would_have_gone_to: vendorEmail,
      provider_id: r.id ?? "unknown",
    };
  }

  return {
    status: "dry_run",
    would_send: { to: vendorEmail, vendor_name: vendorName, subject, body, reply_to: replyTo },
  };
}

/** The email.received webhook is metadata-only — fetch the body separately. */
export async function fetchReceivedEmail(
  emailId: string,
): Promise<{ text: string; subject?: string }> {
  if (!RESEND_KEY) return { text: "" };
  for (const path of [`/emails/receiving/${emailId}`, `/emails/${emailId}`]) {
    const res = await fetch(`https://api.resend.com${path}`, {
      headers: { authorization: `Bearer ${RESEND_KEY}` },
    });
    if (res.ok) {
      const json = (await res.json()) as { text?: string; html?: string; subject?: string };
      const text = json.text ?? (json.html ? json.html.replace(/<[^>]+>/g, " ") : "");
      return { text: text.trim(), subject: json.subject };
    }
  }
  return { text: "(could not fetch reply body)" };
}

/** Tell the couple something happened, without them having to open the app. */
export async function notifyCouple(
  subject: string,
  body: string,
  idempotencyKey?: string,
): Promise<boolean> {
  if (!RESEND_KEY || !NOTIFY_EMAIL) return false;
  try {
    await resendPost(
      "/emails",
      {
        from: FROM,
        to: [NOTIFY_EMAIL],
        subject,
        text: body,
      },
      idempotencyKey,
    );
    return true;
  } catch {
    return false;
  }
}
