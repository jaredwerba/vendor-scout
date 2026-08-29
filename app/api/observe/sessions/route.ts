import { listTraces, traceConfigured } from "@/agent/lib/trace";

export const dynamic = "force-dynamic";

/**
 * Every root session, newest first — the session picker on /observe.
 * Summaries are already redacted at write time (agent/lib/trace.ts), so this
 * route needs no gate and can be read by anyone with the link.
 */
export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25);
  const sessions = traceConfigured() ? await listTraces(Math.min(100, Math.max(1, limit))) : [];
  return Response.json(
    { configured: traceConfigured(), sessions },
    { headers: { "cache-control": "no-store" } },
  );
}
