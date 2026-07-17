/**
 * The outreach roster — the agent's memory of every vendor contact, living
 * OUTSIDE any one conversation (Upstash Redis via REST, plain fetch).
 *
 * Written by: send_outreach (tool), the inbound-email webhook (channel), and
 * the followup-sweep schedule. Read by: check_outreach_status / cancel_followups
 * and the sweep. Eve's own state is per-session, so cross-session memory like
 * this must live in an external store.
 *
 * Concurrency rules (schedule dispatch is at-least-once):
 *  - due follow-ups are claimed with an atomic SET NX lease before sending
 *  - daily send counts use INCR with a TTL
 *  - caps are re-checked at send time, not only at approval time
 */

const URL_BASE =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";

export const rosterConfigured = () => Boolean(URL_BASE && TOKEN);

export type OutreachStatus =
  | "drafted"
  | "sent"
  | "replied"
  | "nudged_1"
  | "nudged_2"
  | "closed"
  | "declined";

export interface ThreadEntry {
  who: "agent" | "vendor";
  when: string;
  subject?: string;
  text: string;
}

export interface ReplyIntelRecord {
  intent: string;
  availability: string | null;
  price_info: string | null;
  questions: string[];
  summary: string;
  sentiment: string;
  via: "model" | "heuristic";
}

export interface OutreachRecord {
  id: string;
  vendor_name: string;
  vendor_email: string;
  subject: string;
  couple_summary: string;
  status: OutreachStatus;
  thread: ThreadEntry[];
  followups_authorized: boolean;
  nudge_count: number;
  sent_at: string | null;
  last_activity_at: string;
  next_followup_at: string | null;
  reply_address: string | null;
  /** Understanding of the latest vendor reply (newer records). */
  reply_intel?: ReplyIntelRecord | null;
}

export const MAX_NUDGES = 2;
export const MAX_EMAILS_PER_VENDOR = 3;
// Owner directive: the daily throttle must never block real planning (a single
// wedding can legitimately need dozens of sends in a day). 200 is a
// runaway-loop backstop, not a product limit. Per-vendor caps stay — they
// protect the couple's reputation with vendors.
export const DAILY_SEND_CAP = Number(process.env.OUTREACH_DAILY_CAP ?? 200);
const FOLLOWUP_SPACING_DAYS = 3;
const LEASE_TTL_SECONDS = 3600;

async function redis(...command: (string | number)[]): Promise<unknown> {
  if (!rosterConfigured()) throw new Error("Roster store is not configured.");
  const res = await fetch(URL_BASE, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command.map(String)),
  });
  const json = (await res.json().catch(() => ({}))) as {
    result?: unknown;
    error?: string;
  };
  if (!res.ok || json.error) {
    throw new Error(`Roster store error: ${json.error ?? res.status}`);
  }
  return json.result;
}

const key = (id: string) => `outreach:${id}`;
const INDEX = "outreach:index";

export async function getRecord(id: string): Promise<OutreachRecord | null> {
  const raw = (await redis("GET", key(id))) as string | null;
  return raw ? (JSON.parse(raw) as OutreachRecord) : null;
}

export async function putRecord(rec: OutreachRecord): Promise<void> {
  rec.last_activity_at = new Date().toISOString();
  await redis("SET", key(rec.id), JSON.stringify(rec));
  await redis("SADD", INDEX, rec.id);
}

export async function listRecords(): Promise<OutreachRecord[]> {
  const ids = ((await redis("SMEMBERS", INDEX)) as string[] | null) ?? [];
  const records: OutreachRecord[] = [];
  for (const id of ids) {
    const rec = await getRecord(id);
    if (rec) records.push(rec);
  }
  return records.sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1));
}

export function newRecord(fields: {
  vendor_name: string;
  vendor_email: string;
  subject: string;
  couple_summary: string;
  followups_authorized: boolean;
  reply_address: string | null;
}): OutreachRecord {
  return {
    id: crypto.randomUUID().slice(0, 8),
    ...fields,
    status: "drafted",
    thread: [],
    nudge_count: 0,
    sent_at: null,
    last_activity_at: new Date().toISOString(),
    next_followup_at: null,
  };
}

export function scheduleNextFollowup(rec: OutreachRecord): void {
  if (rec.followups_authorized && rec.nudge_count < MAX_NUDGES) {
    const next = new Date();
    next.setDate(next.getDate() + FOLLOWUP_SPACING_DAYS);
    rec.next_followup_at = next.toISOString();
  } else {
    rec.next_followup_at = null;
  }
}

const DECLINE_HINTS = [
  "not available",
  "unavailable",
  "already booked",
  "fully booked",
  "not taking",
  "unable to",
  "can't accommodate",
  "cannot accommodate",
  "no longer",
  "unsubscribe",
  "remove me",
  "stop contacting",
  "not interested",
];

export function looksLikeDecline(text: string): boolean {
  const t = text.toLowerCase();
  return DECLINE_HINTS.some((h) => t.includes(h));
}

export async function recordReply(
  id: string,
  reply: { from: string; subject?: string; text: string },
  intel?: ReplyIntelRecord | null,
): Promise<OutreachRecord | null> {
  const rec = await getRecord(id);
  if (!rec) return null;
  rec.thread.push({
    who: "vendor",
    when: new Date().toISOString(),
    subject: reply.subject,
    text: reply.text.slice(0, 4000),
  });
  // Intelligence decides the status; keywords only when no intel exists.
  // "unavailable" (can't do the date) and hard declines both stop the chase.
  const closedIntents = new Set(["declined", "unsubscribe", "unavailable"]);
  rec.status = intel
    ? closedIntents.has(intel.intent)
      ? "declined"
      : "replied"
    : looksLikeDecline(reply.text)
      ? "declined"
      : "replied";
  rec.reply_intel = intel ?? null;
  rec.next_followup_at = null; // vendor answered — never nudge again
  await putRecord(rec);
  return rec;
}

export async function cancelFollowups(id: string): Promise<OutreachRecord | null> {
  const rec = await getRecord(id);
  if (!rec) return null;
  rec.followups_authorized = false;
  rec.next_followup_at = null;
  await putRecord(rec);
  return rec;
}

/** Find records whose reply_address plus-tag or sender matches an inbound email. */
export async function findRecordForInbound(
  toAddresses: string[],
  fromAddress: string,
): Promise<OutreachRecord | null> {
  // Plus-address correlation: replies+{id}@... appears in the To: list.
  for (const to of toAddresses) {
    const m = to.toLowerCase().match(/\+([a-z0-9-]+)@/);
    if (m) {
      const rec = await getRecord(m[1]);
      if (rec) return rec;
    }
  }
  // Fallback: match the vendor's sending address.
  const from = fromAddress.toLowerCase();
  const all = await listRecords();
  return (
    all.find((r) => from.includes(r.vendor_email.toLowerCase())) ?? null
  );
}

// ---------- caps & counters ----------

const todayKey = () => `outreach:daily:${new Date().toISOString().slice(0, 10)}`;

export async function underDailyCap(): Promise<boolean> {
  const n = Number((await redis("GET", todayKey())) ?? 0);
  return n < DAILY_SEND_CAP;
}

export async function countDailySend(): Promise<void> {
  await redis("INCR", todayKey());
  await redis("EXPIRE", todayKey(), 172800);
}

const vendorKey = (email: string) => `outreach:vendor:${email.toLowerCase()}`;

export async function vendorEmailCount(email: string): Promise<number> {
  return Number((await redis("GET", vendorKey(email))) ?? 0);
}

export async function countVendorEmail(email: string): Promise<void> {
  await redis("INCR", vendorKey(email));
}

// ---------- follow-up sweep support ----------

export async function claimDueFollowups(limit: number): Promise<OutreachRecord[]> {
  const now = new Date().toISOString();
  const all = await listRecords();
  const due = all.filter(
    (r) =>
      (r.status === "sent" || r.status === "nudged_1") &&
      r.followups_authorized &&
      r.nudge_count < MAX_NUDGES &&
      r.next_followup_at !== null &&
      r.next_followup_at <= now,
  );
  const claimed: OutreachRecord[] = [];
  for (const rec of due) {
    if (claimed.length >= limit) break;
    // Atomic lease: only one sweep run may own this nudge.
    const lease = await redis(
      "SET",
      `outreach:lease:${rec.id}:${rec.nudge_count + 1}`,
      "1",
      "NX",
      "EX",
      LEASE_TTL_SECONDS,
    );
    if (lease === "OK") claimed.push(rec);
  }
  return claimed;
}

export async function completeNudge(rec: OutreachRecord): Promise<void> {
  rec.nudge_count += 1;
  rec.status = rec.nudge_count >= MAX_NUDGES ? "nudged_2" : "nudged_1";
  rec.thread.push({
    who: "agent",
    when: new Date().toISOString(),
    text: `(automatic follow-up #${rec.nudge_count} sent)`,
  });
  scheduleNextFollowup(rec);
  await putRecord(rec);
}

export async function releaseNudge(rec: OutreachRecord): Promise<void> {
  await redis("DEL", `outreach:lease:${rec.id}:${rec.nudge_count + 1}`);
}
