import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc, type AuthFn } from "eve/channels/auth";

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
  return async () => {
    if (!(await underDailyRequestCap())) return null; // cap exhausted -> 401
    return {
      authenticator: "public-link",
      principalId: "couple",
      principalType: "user",
      attributes: {},
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
