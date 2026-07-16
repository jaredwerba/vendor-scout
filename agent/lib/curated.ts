/**
 * "Curated by Venus" — every wedding she builds is saved here: the couple's
 * brief and the full three-option plan, browsable at /curated behind the same
 * access gate as the app. Stored in the existing Upstash KV.
 */

const URL_BASE =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";

export const curatedConfigured = () => Boolean(URL_BASE && TOKEN);

export interface CuratedWedding {
  id: string;
  created_at: string;
  title: string;
  first_name: string;
  budget_usd: number;
  location: string;
  season: string;
  guest_count: string;
  style: string;
  brief_summary: string;
  plan_markdown: string;
  hero_image_url: string | null;
  /** Every venue photo used in the plan (newer records; legacy may lack them). */
  image_urls?: string[];
  /** Estimated totals per tier, for gallery display. */
  tier_totals?: { ultra_luxe: number; elevated: number; intimate: number } | null;
  /** The specialists' complete findings — every vendor considered, per category. */
  research_markdown?: string | null;
}

async function redis(...command: (string | number)[]): Promise<unknown> {
  const res = await fetch(URL_BASE, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command.map(String)),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    result?: unknown;
    error?: string;
  };
  if (!res.ok || json.error) {
    throw new Error(`Curated store error: ${json.error ?? res.status}`);
  }
  return json.result;
}

const key = (id: string) => `curated:${id}`;
const INDEX = "curated:index";

export async function saveCuratedWedding(
  fields: Omit<CuratedWedding, "id" | "created_at">,
): Promise<CuratedWedding> {
  const rec: CuratedWedding = {
    id: crypto.randomUUID().slice(0, 8),
    created_at: new Date().toISOString(),
    ...fields,
  };
  await redis("SET", key(rec.id), JSON.stringify(rec));
  await redis("SADD", INDEX, rec.id);
  return rec;
}

export async function getCuratedWedding(id: string): Promise<CuratedWedding | null> {
  if (!curatedConfigured()) return null;
  const raw = (await redis("GET", key(id))) as string | null;
  return raw ? (JSON.parse(raw) as CuratedWedding) : null;
}

export async function listCuratedWeddings(): Promise<CuratedWedding[]> {
  if (!curatedConfigured()) return [];
  const ids = ((await redis("SMEMBERS", INDEX)) as string[] | null) ?? [];
  const out: CuratedWedding[] = [];
  for (const id of ids) {
    const raw = (await redis("GET", key(id))) as string | null;
    if (raw) out.push(JSON.parse(raw) as CuratedWedding);
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
