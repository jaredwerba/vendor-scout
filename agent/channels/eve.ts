import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc, type AuthFn } from "eve/channels/auth";
import { MODEL_HEADER, sanitizeChoice } from "../lib/model-choice";

/**
 * Public-link auth: Venus is open to anyone who has the URL. No access code,
 * no sign-in — every browser request to the chat routes is accepted as the
 * shared "couple" principal.
 *
 * - The one guard that remains is a generous KV-backed daily request counter
 *   that caps runaway/scripted use; it fails OPEN if the store is unreachable
 *   (availability over strictness for a demo product). Real-world runaway
 *   protection lives in the outreach caps (per-vendor + daily sends).
 * - The inbound-email webhook channel is untouched: custom channels own
 *   their auth (svix signature), this walk guards only the chat routes.
 */

const DAILY_REQUEST_CAP = 2000;

async function underDailyRequestCap(): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return true; // fail open
  try {
    const key = `access:daily:${new Date().toISOString().slice(0, 10)}`;
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, "172800"],
      ]),
    });
    const json = (await res.json()) as Array<{ result?: number }>;
    return (json?.[0]?.result ?? 0) <= DAILY_REQUEST_CAP;
  } catch {
    return true;
  }
}

function publicLink(): AuthFn<Request> {
  return async (request) => {
    if (!(await underDailyRequestCap())) return null; // cap exhausted -> 401
    // The visitor may choose the planner's model. The value is carried on a
    // header and validated against an allowlist here, at the boundary — a
    // free-text model id from a browser is a footgun, and an unknown one
    // would otherwise fall through to a silent default.
    const attributes: Record<string, string> = {};
    const requested = sanitizeChoice(request?.headers?.get(MODEL_HEADER));
    if (requested) attributes.plannerModel = requested;
    return {
      authenticator: "public-link",
      principalId: "couple",
      principalType: "user",
      attributes,
    };
  };
}

export default eveChannel({
  auth: [
    // Vercel runtime callers, the eve TUI, and scripted OIDC drivers.
    vercelOidc(),
    // Open on localhost for `eve dev`; ignored everywhere else.
    localDev(),
    // Anyone with the link — the public front door.
    publicLink(),
  ],
});
