import { createHash, timingSafeEqual } from "node:crypto";
import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc, type AuthFn } from "eve/channels/auth";

/**
 * Access-code auth: the app is public at the production URL for anyone who
 * has the shared code (set once on the unlock page, carried as an httpOnly
 * cookie the browser attaches to every same-origin request).
 *
 * - The cookie value is compared to ACCESS_CODE server-side, constant-time
 *   (sha256 both sides so lengths always match).
 * - Rotating the code = changing one env var; every device must re-unlock.
 * - A generous KV-backed daily request counter caps runaway/scripted use;
 *   it fails OPEN if the store is unreachable (availability over strictness
 *   for a demo product — the code is the actual gate).
 * - The inbound-email webhook channel is untouched: custom channels own
 *   their auth (svix signature), this walk guards only the chat routes.
 */

const DAILY_REQUEST_CAP = 2000;

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function codesMatch(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function underDailyRequestCap(): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return true; // fail open — the code is the gate
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

function accessCode(): AuthFn<Request> {
  return async (request) => {
    const expected = process.env.ACCESS_CODE;
    if (!expected) return null; // not configured -> walk falls through (fail closed)
    const candidate = readCookie(request.headers.get("cookie"), "vs_code");
    if (!candidate || !codesMatch(candidate, expected)) return null;
    if (!(await underDailyRequestCap())) return null; // cap exhausted -> 401
    return {
      authenticator: "access-code",
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
    // The shared access code — the public front door.
    accessCode(),
  ],
});
