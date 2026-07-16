import { NextResponse, type NextRequest } from "next/server";

/**
 * Page-level gate: without the access cookie, the chat page redirects to the
 * unlock form. This is UX, not the security boundary — the eve channel's
 * accessCode() AuthFn independently validates the cookie on every agent
 * request. Matcher covers ONLY the chat page: /eve/* (agent routes + the
 * vendor-reply webhook), /unlock, /api/unlock, and static assets are never
 * touched by this middleware.
 */
export function middleware(request: NextRequest) {
  const hasCookie = Boolean(request.cookies.get("vs_code")?.value);
  if (!hasCookie) {
    return NextResponse.redirect(new URL("/unlock", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
