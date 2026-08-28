/**
 * Drive one real turn against a deployed Venus and print what came back —
 * the fastest way to prove the model plane (Nebius Token Factory) and the
 * public eve channel work end to end. Creates a real session; sends nothing
 * to vendors (the opener never triggers outreach).
 *
 *   node scripts/smoke-chat.mjs https://vendor-scout-xi.vercel.app
 */
import { Client } from "eve/client";

const host = process.argv[2] ?? "https://vendor-scout-xi.vercel.app";
const client = new Client({ host });
const health = await client.health();
console.log("health:", health.status);
const session = client.session();
const t0 = Date.now();
const response = await session.send("Hi Venus! Our budget is around $28,000 — plan our wedding for us.");
console.log("session:", response.sessionId);
const result = await response.result();
const types = {};
for (const e of result.events) types[e.type] = (types[e.type] ?? 0) + 1;
const model = result.events.find((e) => e.type === "session.started")?.data?.runtime?.modelId;
console.log(`status: ${result.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s · model: ${model ?? "?"}`);
console.log("events:", JSON.stringify(types));
console.log("reply:", (result.message ?? "").slice(0, 400).replace(/\n+/g, " "));
