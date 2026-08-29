/**
 * The research store — what the specialists found, written down the moment
 * they find it.
 *
 * A research child used to return one big JSON blob at the end of its run.
 * That makes every finding hostage to the last token: a truncated reply, a
 * transient provider error or a cancelled turn loses the whole category, and
 * it loses it *silently* — the root sees an empty result and has no way to
 * tell "nothing exists" from "the message got cut". So each specialist calls
 * `record_vendor` per vendor instead, and this module is where those land.
 *
 * Partial progress survives, and "recorded 0" becomes a detectable failure.
 *
 * Keys: research:<rootSessionId>          (set of category slugs)
 *       record:<rootSessionId>:<category> (hash: vendor slug -> JSON finding)
 */

import { categorySlug } from "./actions";

const URL_BASE = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
const TTL_SECONDS = 60 * 60 * 24 * 30;

export const researchConfigured = () => Boolean(URL_BASE && TOKEN);

type Cmd = (string | number)[];

async function redis(commands: Cmd[]): Promise<unknown[]> {
  const res = await fetch(`${URL_BASE}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`research store: redis ${res.status}`);
  const json = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  return json.map((r) => r.result ?? null);
}

export interface VendorFinding {
  category: string;
  name: string;
  website: string | null;
  /** A published address, or the literal "contact form only". */
  inquiryEmail: string | null;
  priceSignal: string | null;
  includes: string | null;
  styleFit: string | null;
  caveat: string | null;
  sourceUrl: string | null;
  imageUrls: string[];
  recordedAt: string;
  /** The specialist session that found it — links a finding to its lane. */
  bySession: string;
}

const catsKey = (root: string) => `research:${root}`;
const recKey = (root: string, category: string) => `record:${root}:${categorySlug(category)}`;

function vendorSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "vendor";
}

/** Idempotent per (root, category, vendor name): a re-record updates in place. */
export async function recordVendor(
  rootSessionId: string,
  finding: Omit<VendorFinding, "recordedAt">,
): Promise<{ stored: boolean; total: number }> {
  if (!researchConfigured()) return { stored: false, total: 0 };
  const full: VendorFinding = { ...finding, recordedAt: new Date().toISOString() };
  const k = recKey(rootSessionId, finding.category);
  const [, , , total] = await redis([
    ["HSET", k, vendorSlug(finding.name), JSON.stringify(full)],
    ["EXPIRE", k, TTL_SECONDS],
    ["SADD", catsKey(rootSessionId), categorySlug(finding.category)],
    ["HLEN", k],
  ]);
  await redis([["EXPIRE", catsKey(rootSessionId), TTL_SECONDS]]);
  return { stored: true, total: Number(total ?? 0) };
}

export async function listCategories(rootSessionId: string): Promise<string[]> {
  if (!researchConfigured()) return [];
  const [cats] = (await redis([["SMEMBERS", catsKey(rootSessionId)]])) as [string[] | null];
  return (cats ?? []).sort();
}

export async function listFindings(rootSessionId: string, category: string): Promise<VendorFinding[]> {
  if (!researchConfigured()) return [];
  const [hash] = (await redis([["HGETALL", recKey(rootSessionId, category)]])) as [
    Record<string, string> | string[] | null,
  ];
  const values = Array.isArray(hash)
    ? hash.filter((_, i) => i % 2 === 1)
    : Object.values(hash ?? {});
  return values
    .map((raw) => {
      try {
        return JSON.parse(raw) as VendorFinding;
      } catch {
        return null;
      }
    })
    .filter((f): f is VendorFinding => Boolean(f));
}

export async function listAllFindings(
  rootSessionId: string,
): Promise<Record<string, VendorFinding[]>> {
  const cats = await listCategories(rootSessionId);
  const out: Record<string, VendorFinding[]> = {};
  for (const c of cats) out[c] = await listFindings(rootSessionId, c);
  return out;
}

/** Live count per category — cheap enough to poll from the observability API. */
export async function countByCategory(rootSessionId: string): Promise<Record<string, number>> {
  const cats = await listCategories(rootSessionId);
  if (cats.length === 0) return {};
  const counts = (await redis(cats.map((c) => ["HLEN", recKey(rootSessionId, c)]))) as unknown[];
  const out: Record<string, number> = {};
  cats.forEach((c, i) => {
    out[c] = Number(counts[i] ?? 0);
  });
  return out;
}
