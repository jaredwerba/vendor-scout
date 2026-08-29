import { countByCategory } from "@/agent/lib/research";
import { traceUrl } from "@/agent/lib/langsmith";
import { getTraceEvents, getTraceTree, traceConfigured } from "@/agent/lib/trace";

export const dynamic = "force-dynamic";

/**
 * One whole agent tree: Venus plus every specialist it delegated to, each
 * with its own recorded event log. This is what the live rail falls back to
 * after a reload (when the browser can no longer be attached to a finished
 * child stream) and what /observe renders for any session id.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!traceConfigured()) {
    return Response.json({ configured: false }, { headers: { "cache-control": "no-store" } });
  }

  const tree = await getTraceTree(id);
  const [rootEvents, childEvents, research, langsmithUrl] = await Promise.all([
    getTraceEvents(id),
    Promise.all(tree.children.map((c) => getTraceEvents(c.id))),
    countByCategory(id).catch(() => ({})),
    traceUrl(tree.langsmithTraceId).catch(() => null),
  ]);

  return Response.json(
    {
      configured: true,
      root: tree.root,
      children: tree.children,
      events: {
        [id]: rootEvents,
        ...Object.fromEntries(tree.children.map((c, i) => [c.id, childEvents[i] ?? []])),
      },
      research,
      langsmith: { traceId: tree.langsmithTraceId, url: langsmithUrl },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
