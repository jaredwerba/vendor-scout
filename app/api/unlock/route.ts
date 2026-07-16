import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Exchanges the shared access code for an httpOnly cookie. The cookie is what
 * the eve channel's accessCode() AuthFn validates on every chat request, and
 * what middleware.ts checks before serving the chat page.
 */

function codesMatch(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.ACCESS_CODE;
  if (!expected) {
    return Response.json({ ok: false, error: "Access code not configured." }, { status: 503 });
  }
  let code = "";
  try {
    const body = (await request.json()) as { code?: string };
    code = (body.code ?? "").trim();
  } catch {
    return Response.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  if (!code || !codesMatch(code, expected)) {
    return Response.json({ ok: false, error: "That code isn't right." }, { status: 401 });
  }
  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": `vs_code=${encodeURIComponent(code)}; Path=/; Max-Age=${60 * 60 * 24 * 60}; HttpOnly; Secure; SameSite=Lax`,
        "cache-control": "no-store",
      },
    },
  );
}
