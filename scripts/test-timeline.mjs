/**
 * Smoke test for the Countdown store logic against the real KV.
 * Run: node --env-file=.env.local scripts/test-timeline.mjs
 * Uses throwaway keys via the same REST calls; cleans up after itself.
 */
import assert from "node:assert";

const URL_BASE = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
if (!URL_BASE || !TOKEN) {
  console.error("KV env missing — run with --env-file=.env.local");
  process.exit(1);
}
const redis = async (...c) => {
  const res = await fetch(URL_BASE, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(c.map(String)),
  });
  return (await res.json()).result;
};

// The lib is TS; test the storage contract directly with the same shapes.
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => iso(new Date(today.getTime() + n * 864e5));

const M = (id, due, status = "upcoming", notified_on = null) => ({
  id, title: `t-${id}`, detail: "d", due_date: due, category: "logistics", status, notified_on,
});

// seed
const fixtures = [
  M("tl_a", inDays(3)),            // in window -> due
  M("tl_b", inDays(30)),           // out of window -> not due
  M("tl_c", inDays(-2)),           // overdue -> due
  M("tl_d", inDays(5), "done"),    // done -> not due
  M("tl_e", inDays(5), "upcoming", iso(today)), // already notified today -> not due
];
for (const m of fixtures) {
  await redis("SET", `timeline:${m.id}`, JSON.stringify(m));
  await redis("SADD", "timeline:index", m.id);
}

// replicate dueForCheckin's filter (window 14d, idempotent per day)
const horizon = inDays(14);
const ids = await redis("SMEMBERS", "timeline:index");
const all = [];
for (const id of ids) {
  const raw = await redis("GET", `timeline:${id}`);
  if (raw) all.push(JSON.parse(raw));
}
const mine = all.filter((m) => m.id.startsWith("tl_"));
const due = mine.filter(
  (m) => m.status === "upcoming" && m.due_date <= horizon && m.notified_on !== iso(today),
);
const dueIds = due.map((m) => m.id).sort();
assert.deepStrictEqual(dueIds, ["tl_a", "tl_c"], `expected [tl_a, tl_c], got ${dueIds}`);

// idempotency: mark notified, re-filter -> empty
for (const m of due) {
  m.notified_on = iso(today);
  await redis("SET", `timeline:${m.id}`, JSON.stringify(m));
}
const again = [];
for (const id of ids) {
  const raw = await redis("GET", `timeline:${id}`);
  if (raw) again.push(JSON.parse(raw));
}
const dueAgain = again.filter(
  (m) =>
    m.id.startsWith("tl_") &&
    m.status === "upcoming" &&
    m.due_date <= horizon &&
    m.notified_on !== iso(today),
);
assert.strictEqual(dueAgain.length, 0, "second sweep must find nothing (idempotent)");

// cleanup
for (const m of fixtures) {
  await redis("DEL", `timeline:${m.id}`);
  await redis("SREM", "timeline:index", m.id);
}
console.log("✓ timeline store contract: window + overdue + done-skip + per-day idempotency");
