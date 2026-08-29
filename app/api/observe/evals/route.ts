import { listEvalSummaries, traceConfigured } from "@/agent/lib/trace";

export const dynamic = "force-dynamic";

/** Every eval summary the scripts have uploaded. */
export async function GET() {
  const evals = traceConfigured() ? await listEvalSummaries() : [];
  return Response.json(
    { configured: traceConfigured(), evals },
    { headers: { "cache-control": "no-store" } },
  );
}
