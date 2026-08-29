/**
 * The only thing that turns a run into a score.
 *
 * Both implementations — eve on Vercel, LangGraph on Nebius — write a
 * RunResult (evals/harness/run-result.schema.json). This grades them with
 * identical code against the identical fixed briefs, and knows nothing about
 * either stack beyond the `system` label it prints. Two graders that "do the
 * same thing" is how a comparison quietly becomes marketing.
 *
 *   npm run grade -- runs/eve-boston-boho.json [more.json ...]
 */
import { readFileSync } from "node:fs";
import { generateObject } from "ai";
import { z } from "zod";
import type { FindingFacts, RunResult } from "../evals/harness/types.ts";
import { specialists, totalCost, totalVendors } from "../evals/harness/types.ts";
import { modelFor, modelIdFor } from "../agent/lib/models.ts";
import { formatUsd } from "../agent/lib/pricing.ts";
import { directoryHost, emailLooksForeign, isContactFormOnly } from "../agent/lib/vendor-guards.ts";
import { type EvalCaseResult, saveEvalSummary, traceConfigured } from "../agent/lib/trace.ts";

interface Brief {
  id: string;
  budget: number;
  region: string;
  message: string;
}
const briefs = JSON.parse(
  readFileSync(new URL("../evals/data/briefs.json", import.meta.url), "utf8"),
) as Brief[];

const files = process.argv.slice(2).filter((a) => a.endsWith(".json"));
if (files.length === 0) {
  console.error("usage: npm run grade -- <run-result.json> [...]");
  process.exit(1);
}

/**
 * A source URL that is definitively gone is not a source. Lenient on purpose:
 * a 403 is bot blocking and a timeout is the network, and discarding a real
 * vendor for either is the more expensive error.
 */
async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });
    return res.status !== 404 && res.status !== 410;
  } catch {
    return true;
  }
}

const verdictSchema = z.object({
  real: z.boolean().describe("A real, currently-operating business of this category?"),
  serves_region: z.boolean().describe("Located INSIDE the couple's stated travel radius?"),
  reason: z.string().max(220),
});

async function judge(f: FindingFacts, region: string) {
  const { object } = await generateObject({
    model: modelFor("judge"),
    schema: verdictSchema,
    prompt: [
      "You are auditing one wedding-vendor research result. Judge only what is asserted here.",
      `Region the couple is searching: ${region}`,
      `Category: ${f.category}`,
      `Business: ${f.name}`,
      `Website: ${f.website ?? "(none)"}`,
      `Source: ${f.sourceUrl ?? "(none)"}`,
      `Stated location: ${f.location ?? "(none)"}${f.distanceNote ? ` — ${f.distanceNote}` : ""}`,
      "",
      "Two independent questions:",
      "1. real — is this a real, currently-operating business of that category? A placeholder,",
      "   an invented-sounding name with no website, or a defunct business fails.",
      "2. serves_region — is it INSIDE the stated travel radius? Reason about the actual drive:",
      "   anything within the radius passes, including at its edge. Fail only when clearly",
      "   outside — a different state, or a drive well beyond what they said they would travel.",
      "   Do not fail a business merely for being in a different town; that is what a radius is.",
    ].join("\n"),
  });
  return object;
}

interface Scorecard {
  system: string;
  briefId: string;
  passed: number;
  total: number;
  cases: EvalCaseResult[];
  costUsd: number;
  wallClockMs: number;
  vendors: number;
  agents: number;
  corpusHits: number;
}

async function grade(run: RunResult): Promise<Scorecard> {
  const brief = briefs.find((b) => b.id === run.briefId);
  const region = brief?.region ?? run.briefId;
  const cases: EvalCaseResult[] = [];
  const note = (ok: boolean, name: string, expected: string, got: string, extra?: string) => {
    cases.push({ name, expected, got, ok, note: extra });
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(52)} ${got}`);
  };

  console.log(`\n=== ${run.system} · ${run.briefId}`);

  note(
    run.status === "completed" || run.status === "waiting",
    `${run.system} · turn`,
    "the run settled",
    `${run.status ?? "unknown"} in ${(run.wallClockMs / 1000).toFixed(0)}s`,
  );

  const kids = specialists(run);
  note(kids.length >= 2, `${run.system} · fan-out`, ">=2 specialists", `${kids.length} specialists`);

  for (const k of kids) {
    const recorded = k.vendorsRecorded ?? 0;
    note(
      recorded >= 3,
      `${run.system} · ${k.label} · recorded`,
      ">=3 vendors",
      `${recorded} recorded`,
      (k.truncations ?? 0) > 0 ? "TRUNCATED mid-run" : undefined,
    );
    note(
      (k.truncations ?? 0) === 0,
      `${run.system} · ${k.label} · completed cleanly`,
      "no truncation",
      (k.truncations ?? 0) > 0 ? `${k.truncations} truncated steps` : "clean",
    );
  }

  for (const [category, list] of Object.entries(run.findings)) {
    if (list.length === 0) continue;
    const p = `${run.system} · ${category}`;

    const names = list.map((f) => f.name.trim().toLowerCase());
    note(
      new Set(names).size === names.length,
      `${p} · distinct vendors`,
      "no duplicates",
      `${new Set(names).size}/${names.length} distinct`,
    );

    const contactable = list.filter(
      (f) => f.inquiryEmail && (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.inquiryEmail) || isContactFormOnly(f.inquiryEmail)),
    );
    note(
      contactable.length === list.length,
      `${p} · contact path`,
      "an email or 'contact form only' on every vendor",
      `${contactable.length}/${list.length}`,
    );

    const fromDirectory = list.filter((f) => f.sourceUrl && directoryHost(f.sourceUrl));
    note(
      fromDirectory.length === 0,
      `${p} · own-site sources`,
      "no directory listings as sources",
      fromDirectory.length === 0 ? "clean" : `${fromDirectory.length} from directories`,
      fromDirectory.map((f) => f.name).slice(0, 2).join(", ") || undefined,
    );

    const foreign = list.filter(
      (f) =>
        f.inquiryEmail &&
        !isContactFormOnly(f.inquiryEmail) &&
        emailLooksForeign(f.inquiryEmail, f.website, f.name),
    );
    note(
      foreign.length === 0,
      `${p} · emails belong to the vendor`,
      "no addresses from unrelated domains",
      foreign.length === 0 ? "clean" : `${foreign.length} suspicious`,
      foreign.map((f) => `${f.name}: ${f.inquiryEmail}`).slice(0, 2).join(" | ") || undefined,
    );

    const located = list.filter((f) => (f.location ?? "").trim().length > 1);
    note(
      located.length === list.length,
      `${p} · location recorded`,
      "every vendor states its town",
      `${located.length}/${list.length}`,
    );

    const sourced = list.filter((f) => f.sourceUrl?.startsWith("https://"));
    const live = await Promise.all(sourced.map((f) => reachable(f.sourceUrl as string)));
    note(
      sourced.length === list.length && live.every(Boolean),
      `${p} · live sources`,
      "every source URL resolves",
      `${live.filter(Boolean).length}/${list.length} reachable`,
    );

    if (category.startsWith("venue")) {
      const withImages = list.filter(
        (f) => (f.imageUrls ?? []).filter((u) => u.startsWith("https://")).length >= 3,
      );
      note(
        withImages.length >= 1,
        `${p} · photos`,
        ">=1 venue with >=3 real photos",
        `${withImages.length} of ${list.length} venues`,
      );
    }

    const sample = list.slice(0, 4);
    let real = 0;
    let inRegion = 0;
    const notReal: string[] = [];
    const outOfRange: string[] = [];
    for (const f of sample) {
      try {
        const v = await judge(f, region);
        if (v.real) real += 1;
        else notReal.push(`${f.name}: ${v.reason}`);
        if (v.serves_region) inRegion += 1;
        else outOfRange.push(`${f.name} (${f.location ?? "?"}): ${v.reason}`);
      } catch (error) {
        notReal.push(`${f.name}: judge failed (${String((error as Error)?.message).slice(0, 60)})`);
      }
    }
    note(
      real === sample.length,
      `${p} · real businesses (judge)`,
      "every sampled vendor is real",
      `${real}/${sample.length}`,
      notReal.slice(0, 2).join(" | ") || undefined,
    );
    note(
      inRegion === sample.length,
      `${p} · within travel radius (judge)`,
      "every sampled vendor is inside the radius",
      `${inRegion}/${sample.length}`,
      outOfRange.slice(0, 2).join(" | ") || undefined,
    );
  }

  const passed = cases.filter((c) => c.ok).length;
  const corpusHits = run.agents.reduce((n, a) => n + (a.corpusHits ?? 0), 0);
  return {
    system: run.system,
    briefId: run.briefId,
    passed,
    total: cases.length,
    cases,
    costUsd: totalCost(run),
    wallClockMs: run.wallClockMs,
    vendors: totalVendors(run),
    agents: run.agents.length,
    corpusHits,
  };
}

const cards: Scorecard[] = [];
for (const file of files) {
  const run = JSON.parse(readFileSync(file, "utf8")) as RunResult;
  cards.push(await grade(run));
}

console.log(`\n${"system".padEnd(20)}${"brief".padEnd(16)}${"score".padStart(9)}${"cost".padStart(10)}${"wall".padStart(9)}${"vendors".padStart(9)}${"agents".padStart(8)}`);
for (const c of cards) {
  console.log(
    c.system.padEnd(20) +
      c.briefId.padEnd(16) +
      `${c.passed}/${c.total}`.padStart(9) +
      formatUsd(c.costUsd).padStart(10) +
      `${(c.wallClockMs / 1000).toFixed(0)}s`.padStart(9) +
      String(c.vendors).padStart(9) +
      String(c.agents).padStart(8) +
      (c.corpusHits ? `  ${c.corpusHits} from corpus` : ""),
  );
}

if (traceConfigured()) {
  for (const c of cards) {
    await saveEvalSummary({
      kind: `grade:${c.system}:${c.briefId}`,
      name: `${c.system} on ${c.briefId} — research quality`,
      ranAt: new Date().toISOString(),
      model: null,
      judgeModel: modelIdFor("judge"),
      n: c.total,
      passed: c.passed,
      score: c.total ? c.passed / c.total : 0,
      cases: c.cases,
      langsmith: null,
      note: `${formatUsd(c.costUsd)} · ${(c.wallClockMs / 1000).toFixed(0)}s · ${c.vendors} vendors · ${c.agents} agents`,
    });
  }
  console.log("\nsaved to KV → /observe");
}
