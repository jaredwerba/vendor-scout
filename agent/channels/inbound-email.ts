import { defineChannel, POST } from "eve/channels";
import { classifyReply } from "../lib/classify";
import { fetchReceivedEmail, notifyCouple } from "../lib/resend";
import { findRecordForInbound, recordReply, rosterConfigured } from "../lib/roster";
import { verifySvix } from "../lib/verify-svix";

/**
 * The agent's ears: Resend Inbound posts `email.received` webhooks here when a
 * vendor replies to one of our plus-addressed reply addresses.
 *
 * - Route is authored at its FULL path: defineChannel mounts paths verbatim,
 *   and on Vercel only /eve/v1/** is forwarded to the eve service.
 * - This route is intentionally public on the production alias; the svix
 *   signature over the raw body IS its authentication. The eve session
 *   routes' auth walk does not apply to custom channels.
 * - v1 makes no model calls: verify → fetch body → correlate → record →
 *   notify the couple. Deterministic, cheap, safe.
 */
export default defineChannel({
  routes: [
    POST("/eve/v1/inbound-email/reply", async (req, { waitUntil }) => {
      // Raw body first — the signature is over these exact bytes.
      const rawBody = await req.text();
      const verified = verifySvix({
        secret: process.env.RESEND_WEBHOOK_SECRET ?? "",
        id: req.headers.get("svix-id") ?? "",
        timestamp: req.headers.get("svix-timestamp") ?? "",
        signature: req.headers.get("svix-signature") ?? "",
        rawBody,
      });
      if (!verified) return new Response("invalid signature", { status: 401 });

      let event: {
        type?: string;
        data?: { email_id?: string; from?: string; to?: string[]; subject?: string };
      };
      try {
        event = JSON.parse(rawBody);
      } catch {
        return new Response("bad payload", { status: 400 });
      }
      if (event.type !== "email.received") return Response.json({ ignored: true });
      if (!rosterConfigured()) return Response.json({ ok: true, note: "roster not configured" });

      const data = event.data ?? {};
      waitUntil(
        (async () => {
          const body = data.email_id
            ? await fetchReceivedEmail(data.email_id)
            : { text: "", subject: data.subject };
          const rec = await findRecordForInbound(data.to ?? [], data.from ?? "");
          if (!rec) return; // unrelated inbound mail — drop silently
          const text = body.text || "(empty reply body)";
          // Understand the reply before filing it — never lose it over a
          // classification failure (heuristic fallback inside).
          const { intel, via } = await classifyReply({
            vendorName: rec.vendor_name,
            replyText: text,
            originalSubject: rec.subject,
          });
          const updated = await recordReply(
            rec.id,
            { from: data.from ?? "unknown", subject: data.subject ?? body.subject, text },
            { ...intel, via },
          );
          if (updated) {
            const headline =
              intel.intent === "available"
                ? "available! 🎉"
                : intel.intent === "priced"
                  ? "sent pricing"
                  : intel.intent === "needs_info"
                    ? "has questions for you"
                    : intel.intent === "unavailable"
                      ? "isn't available"
                      : intel.intent === "declined" || intel.intent === "unsubscribe"
                        ? "passed"
                        : "replied";
            const facts = [
              intel.availability ? `Availability: ${intel.availability}` : null,
              intel.price_info ? `Pricing: ${intel.price_info}` : null,
              intel.questions.length ? `They asked: ${intel.questions.join(" · ")}` : null,
            ].filter(Boolean);
            await notifyCouple(
              `${updated.vendor_name} ${headline}`,
              [
                intel.summary,
                "",
                ...(facts.length ? [...facts, ""] : []),
                "— Full reply —",
                text.slice(0, 1500),
                "",
                updated.status === "declined"
                  ? "I've closed this thread — no more follow-ups to them."
                  : "Follow-ups for this vendor stopped automatically.",
                `Open Venus and ask "how's outreach going?" for the full picture.`,
              ].join("\n"),
              // Idempotent per received email: a replayed webhook or re-run
              // step can't double-notify the couple.
              `notify:${rec.id}:${data.email_id ?? "unknown"}`,
            );
          }
        })(),
      );

      return Response.json({ ok: true });
    }),
  ],
});
