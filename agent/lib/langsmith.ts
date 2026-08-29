/**
 * Deep links into LangSmith.
 *
 * A trace id alone is not a URL — LangSmith needs the tenant and project ids
 * too. Those are stable, so they are fetched once and cached in KV; the app
 * then builds a link for any session without touching the LangSmith API on
 * the request path. When no key is configured the whole module degrades to
 * `null` and the UI shows the button disabled rather than broken.
 */

const URL_BASE = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
const CACHE_KEY = "langsmith:project";
const CACHE_TTL = 60 * 60 * 24;

export const langsmithConfigured = () =>
  Boolean(process.env.LANGSMITH_API_KEY) && process.env.LANGSMITH_TRACING !== "false";

export const langsmithProject = () => process.env.LANGSMITH_PROJECT ?? "venus";

function apiHost(): string {
  return (process.env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com").replace(/\/$/, "");
}

/** api.smith.langchain.com -> smith.langchain.com (the app the link opens). */
function webHost(): string {
  const explicit = process.env.LANGSMITH_WEB_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return apiHost().replace("//api.", "//").replace("/api", "");
}

interface ProjectRef {
  id: string;
  tenantId: string;
}

async function kv(commands: (string | number)[][]): Promise<unknown[]> {
  if (!URL_BASE || !TOKEN) return commands.map(() => null);
  const res = await fetch(`${URL_BASE}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) return commands.map(() => null);
  const json = (await res.json()) as Array<{ result?: unknown }>;
  return json.map((r) => r.result ?? null);
}

let memo: ProjectRef | null = null;

export async function getProjectRef(): Promise<ProjectRef | null> {
  if (!langsmithConfigured()) return null;
  if (memo) return memo;
  const [cached] = await kv([["GET", CACHE_KEY]]);
  if (typeof cached === "string" && cached) {
    try {
      memo = JSON.parse(cached) as ProjectRef;
      return memo;
    } catch {
      // fall through and refetch
    }
  }
  try {
    const url = new URL(`${apiHost()}/api/v1/sessions`);
    url.searchParams.set("name", langsmithProject());
    url.searchParams.set("limit", "1");
    const res = await fetch(url, {
      headers: { "x-api-key": process.env.LANGSMITH_API_KEY ?? "" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{ id?: string; tenant_id?: string }>;
    const row = Array.isArray(body) ? body[0] : null;
    if (!row?.id || !row?.tenant_id) return null;
    memo = { id: row.id, tenantId: row.tenant_id };
    await kv([["SET", CACHE_KEY, JSON.stringify(memo), "EX", CACHE_TTL]]);
    return memo;
  } catch {
    return null;
  }
}

/** The run URL for one OTel trace id, or null if we cannot build a real one. */
export async function traceUrl(traceId: string | null | undefined): Promise<string | null> {
  if (!traceId) return null;
  const ref = await getProjectRef();
  if (!ref) return null;
  return `${webHost()}/o/${ref.tenantId}/projects/p/${ref.id}/r/${traceId}?poll=true`;
}

/** The project URL — useful even when a specific trace id is not known yet. */
export async function projectUrl(): Promise<string | null> {
  const ref = await getProjectRef();
  if (!ref) return null;
  return `${webHost()}/o/${ref.tenantId}/projects/p/${ref.id}`;
}
