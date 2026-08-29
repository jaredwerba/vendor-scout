/**
 * Visible eval: is the research any good?
 *
 * Everything downstream of research — the three visions, the totals, the
 * emails that actually go to strangers — is only as true as what the scouts
 * found. So this drives real planning turns against a running Venus, then
 * grades what the specialists recorded, on three axes:
 *
 *   1. Did each specialist actually work?  (recorded >= 3, not truncated)
 *   2. Is each finding actionable?         (a real contact path, a live source URL)
 *   3. Is the vendor real?                 (LLM judge, pinned to its own model)
 *
 * The judge is deliberately NOT the model under test: swapping NEBIUS_MODEL
 * must never silently change how the results are graded.
 *
 *   npm run eval:scout                    # one brief, against production
 *   npm run eval:scout -- http://localhost:3000 --all
 */
import { readFileSync } from "node:fs";
import { Client } from "eve/client";
import { generateObject } from "ai";
import { z } from "zod";
import { judgeModel, judgeModelId } from "../agent/lib/nebius.ts";
import { listAllFindings, type VendorFinding } from "../agent/lib/research.ts";
import { getTraceTree, type EvalCaseResult, saveEvalSummary, traceConfigured } from "../agent/lib/trace.ts";

interface Brief {
  id: string;
  budget: number;
  region: string;
  message: string;
}

const args = process.argv.slice(2);
const host = args.find((a) => a.startsWith("http")) ?? "https://vendor-scout-xi.vercel.app";
const runAll = args.includes("--all");
const TURN_TIMEOUT_MS = Number(process.env.EVAL_TURN_TIMEOUT_MS ?? 15 * 60 * 1000);

const briefs = JSON.parse(
  readFileSync(new URL("../evals/data/briefs.json", import.meta.url), "utf8"),
) as Brief[];
const selected = runAll ? briefs : briefs.slice(0, 1);
const model = (process.env.NEBIUS_MODEL ?? "").trim() || "Qwen/Qwen3-235B-A22B-Instruct-2507";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A source URL that 404s is not a source. */
async function isLive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "venus-eval/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    return res.status < 400;
  } catch {
    return false;
  }
}

const verdictSchema = z.object({
  real: z.boolean().describe("Is this a real, currently-operating business of this type?"),
  serves_region: z.boolean().describe("Would it plausibly serve the stated region?"),
  reason: z.string().max(200),
});

async function judgeVendor(f: VendorFinding, region: string) {
  const { object } = await generateObject({
    model: judgeModel(),
    schema: verdictSchema,
    prompt: [
      "You are auditing a wedding-vendor research result. Judge only what is asserted here.",
      `Region the couple is searching: ${region}`,
      `Category: ${f.category}`,
      `Business name: ${f.name}`,
      `Website: ${f.website ?? "(none given)"}`,
      `Source: ${f.sourceUrl ?? "(none given)"}`,
      `Price signal: ${f.priceSignal ?? "(none)"}`,
      "Is this a real, currently-operating business of that category, and would it plausibly " +
        "serve that region? A generic directory listing, a placeholder, an invented-sounding " +
        "name with no website, or a business in the wrong region should fail.",
    ].join("\n"),
  });
  return object;
}

const results: EvalCaseResult[] = [];
const note = (ok: boolean, name: string, expected: string, got: string, extra?: string) => {
  results.push({ name, expected, got, ok, note: extra });
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(46)} ${got}`);
};

for (const brief of selected) {
  console.log(`\n=== ${brief.id} · $${brief.budget.toLocaleString("en-US")} · ${brief.region}`);
  const client = new Client({ host });
  const session = client.session();
  const t0 = Date.now();

  let sessionId: string | null = null;
  let status = "unknown";
  try {
    const response = await session.send({
      message: brief.message,
      signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    });
    sessionId = response.sessionId ?? null;
    console.log(`session ${sessionId}`);
    const result = await response.result();
    status = result.status;
  } catch (error) {
    status = `error: ${String((error as Error)?.message ?? error).slice(0, 120)}`;
  }
  const seconds = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`turn ${status} in ${seconds}s`);

  if (!sessionId) {
    note(false, `${brief.id} · turn`, "a completed planning turn", status);
    continue;
  }
  note(status !== "unknown" && !status.startsWith("error"), `${brief.id} · turn`, "completed", `${status} (${seconds}s)`);

  // --- What the specialists actually did.
  const tree = await getTraceTree(sessionId);
  const findings = await listAllFindings(sessionId);
  const categories = Object.keys(findings);

  note(
    tree.children.length >= 2,
    `${brief.id} · fan-out`,
    ">=2 specialists",
    `${tree.children.length} specialists`,
  );

  for (const child of tree.children) {
    const label = child.label || child.agentName || child.id.slice(-6);
    note(
      child.vendorsRecorded >= 3,
      `${brief.id} · ${label} · recorded`,
      ">=3 vendors",
      `${child.vendorsRecorded} recorded`,
      child.truncations > 0 ? "TRUNCATED mid-run" : undefined,
    );
    note(
      child.truncations === 0,
      `${brief.id} · ${label} · completed cleanly`,
      "no truncation",
      child.truncations > 0 ? `${child.truncations} truncated steps` : "clean",
    );
  }

  // --- Is each finding actionable?
  for (const category of categories) {
    const list = findings[category] ?? [];
    if (list.length === 0) continue;

    const names = list.map((f) => f.name.trim().toLowerCase());
    note(
      new Set(names).size === names.length,
      `${brief.id} · ${category} · distinct vendors`,
      "no duplicates",
      `${new Set(names).size}/${names.length} distinct`,
    );

    const contactable = list.filter(
      (f) => f.inquiryEmail && (EMAIL.test(f.inquiryEmail) || /contact form/i.test(f.inquiryEmail)),
    );
    note(
      contactable.length === list.length,
      `${brief.id} · ${category} · contact path`,
      "every vendor has an email or 'contact form only'",
      `${contactable.length}/${list.length}`,
    );

    const withSource = list.filter((f) => f.sourceUrl?.startsWith("https://"));
    const liveFlags = await Promise.all(withSource.map((f) => isLive(f.sourceUrl as string)));
    const liveCount = liveFlags.filter(Boolean).length;
    note(
      withSource.length === list.length && liveCount === withSource.length,
      `${brief.id} · ${category} · live sources`,
      "every source URL resolves",
      `${liveCount}/${list.length} reachable`,
    );

    if (category.startsWith("venue")) {
      const withImages = list.filter(
        (f) => f.imageUrls.filter((u) => u.startsWith("https://")).length >= 3,
      );
      note(
        withImages.length >= 1,
        `${brief.id} · ${category} · photos`,
        ">=1 venue with >=3 real photos",
        `${withImages.length} of ${list.length} venues`,
      );
    }

    // --- Judge: is it a real business? (sampled, to keep the eval affordable)
    const sample = list.slice(0, 4);
    let realCount = 0;
    const reasons: string[] = [];
    for (const f of sample) {
      try {
        const v = await judgeVendor(f, brief.region);
        if (v.real && v.serves_region) realCount += 1;
        else reasons.push(`${f.name}: ${v.reason}`);
      } catch (error) {
        reasons.push(`${f.name}: judge failed (${String((error as Error)?.message).slice(0, 60)})`);
      }
    }
    note(
      realCount === sample.length,
      `${brief.id} · ${category} · real businesses (judge)`,
      "all sampled vendors real & in-region",
      `${realCount}/${sample.length}`,
      reasons.slice(0, 2).join(" | ") || undefined,
    );
  }
}

const passed = results.filter((r) => r.ok).length;
const score = results.length ? passed / results.length : 0;
console.log(
  `\nscout quality ${passed}/${results.length} = ${(score * 100).toFixed(0)}% · agent ${model} · judge ${judgeModelId()}`,
);

if (traceConfigured()) {
  await saveEvalSummary({
    kind: "scout",
    name: "Research quality (scout specialists: coverage, contactability, live sources, real vendors)",
    ranAt: new Date().toISOString(),
    model,
    judgeModel: judgeModelId(),
    n: results.length,
    passed,
    score,
    cases: results,
    langsmith: null,
    note: `${selected.length} brief${selected.length === 1 ? "" : "s"} against ${host}`,
  });
  console.log("saved to KV → /observe");
} else {
  console.log("KV not configured — summary not saved.");
}
