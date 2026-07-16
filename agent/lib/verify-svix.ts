import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Manual verification of svix-signed webhooks (Resend uses svix) — no
 * dependency needed. Scheme: HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`
 * keyed with the base64-decoded secret (after the `whsec_` prefix); the
 * signature header carries space-delimited `v1,<base64>` candidates.
 * Constant-time comparison; ±5 minute timestamp tolerance against replays.
 */
export function verifySvix(o: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  rawBody: string;
  toleranceSec?: number;
}): boolean {
  if (!o.secret || !o.id || !o.timestamp || !o.signature) return false;
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(o.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (o.toleranceSec ?? 300)) return false;

  const key = Buffer.from(o.secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${o.id}.${o.timestamp}.${o.rawBody}`)
    .digest();

  return o.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      return false;
    }
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}
