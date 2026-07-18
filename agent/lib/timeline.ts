/**
 * The Countdown — Venus's dated wedding timeline.
 *
 * Venus generates the milestones (she knows the couple's date, style, and
 * what's already booked); this lib persists them and powers the proactive
 * check-ins: a daily sweep finds milestones entering their nudge window and
 * sends ONE warm digest per couple per day, idempotently.
 *
 * Storage (same Upstash KV as the roster):
 *   timeline:meta          -> { wedding_date, couple_email, couple_names }
 *   timeline:{id}          -> Milestone
 *   timeline:index         -> set of milestone ids
 */

const URL_BASE =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";

export const timelineConfigured = () => Boolean(URL_BASE && TOKEN);

export interface TimelineMeta {
  wedding_date: string; // ISO date
  couple_email: string | null;
  couple_names: string | null;
  generated_at: string;
}

export type MilestoneStatus = "upcoming" | "done" | "skipped";

export interface Milestone {
  id: string;
  title: string;
  detail: string;
  due_date: string; // ISO date
  category: string; // venue | attire | stationery | food | legal | beauty | logistics | joy
  status: MilestoneStatus;
  /** Date (YYYY-MM-DD) of the last check-in that included this milestone. */
  notified_on: string | null;
}

/** Milestones enter the check-in window this many days before they're due. */
export const NUDGE_WINDOW_DAYS = 14;

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
    throw new Error(`Timeline store error: ${json.error ?? res.status}`);
  }
  return json.result;
}

const key = (id: string) => `timeline:${id}`;
const INDEX = "timeline:index";
const META = "timeline:meta";

export async function getTimelineMeta(): Promise<TimelineMeta | null> {
  if (!timelineConfigured()) return null;
  const raw = (await redis("GET", META)) as string | null;
  return raw ? (JSON.parse(raw) as TimelineMeta) : null;
}

/** Replace the whole timeline — regeneration is always allowed. */
export async function saveTimeline(
  meta: Omit<TimelineMeta, "generated_at">,
  milestones: Omit<Milestone, "id" | "status" | "notified_on">[],
): Promise<{ count: number }> {
  const oldIds = ((await redis("SMEMBERS", INDEX)) as string[] | null) ?? [];
  for (const id of oldIds) {
    await redis("DEL", key(id));
    await redis("SREM", INDEX, id);
  }
  await redis(
    "SET",
    META,
    JSON.stringify({ ...meta, generated_at: new Date().toISOString() }),
  );
  let count = 0;
  for (const m of milestones) {
    const rec: Milestone = {
      id: crypto.randomUUID().slice(0, 8),
      ...m,
      status: "upcoming",
      notified_on: null,
    };
    await redis("SET", key(rec.id), JSON.stringify(rec));
    await redis("SADD", INDEX, rec.id);
    count++;
  }
  return { count };
}

export async function listMilestones(): Promise<Milestone[]> {
  if (!timelineConfigured()) return [];
  const ids = ((await redis("SMEMBERS", INDEX)) as string[] | null) ?? [];
  const out: Milestone[] = [];
  for (const id of ids) {
    const raw = (await redis("GET", key(id))) as string | null;
    if (raw) out.push(JSON.parse(raw) as Milestone);
  }
  return out.sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
}

export async function setMilestoneStatus(
  id: string,
  status: MilestoneStatus,
): Promise<Milestone | null> {
  const raw = (await redis("GET", key(id))) as string | null;
  if (!raw) return null;
  const rec = JSON.parse(raw) as Milestone;
  rec.status = status;
  await redis("SET", key(rec.id), JSON.stringify(rec));
  return rec;
}

/**
 * Milestones that should appear in today's check-in: upcoming, due within the
 * window (or overdue), and not already mentioned today. Idempotent per day —
 * a re-run sweep can't double-send.
 */
export async function dueForCheckin(now: Date): Promise<Milestone[]> {
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + NUDGE_WINDOW_DAYS * 864e5)
    .toISOString()
    .slice(0, 10);
  const all = await listMilestones();
  return all.filter(
    (m) =>
      m.status === "upcoming" &&
      m.due_date <= horizon &&
      m.notified_on !== today,
  );
}

export async function markNotified(ids: string[], now: Date): Promise<void> {
  const today = now.toISOString().slice(0, 10);
  for (const id of ids) {
    const raw = (await redis("GET", key(id))) as string | null;
    if (!raw) continue;
    const rec = JSON.parse(raw) as Milestone;
    rec.notified_on = today;
    await redis("SET", key(rec.id), JSON.stringify(rec));
  }
}

export function daysUntil(dateIso: string, now = new Date()): number {
  return Math.ceil(
    (new Date(`${dateIso}T12:00:00Z`).getTime() - now.getTime()) / 864e5,
  );
}
