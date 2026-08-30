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
import { modelFor, modelIdFor } from "../agent/lib/models.ts";
import { listAllFindings, type VendorFinding } from "../agent/lib/research.ts";
import { directoryHost, emailLooksForeign, isContactFormOnly } from "../agent/lib/vendor-guards.ts";
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
/** How long to let the specialists finish after the parent turn parks. */
const SPECIALIST_SETTLE_MS = Number(process.env.EVAL_SETTLE_TIMEOUT_MS ?? 12 * 60 * 1000);

const briefs = JSON.parse(
  readFileSync(new URL("../evals/data/briefs.json", import.meta.url), "utf8"),
) as Brief[];
const selected = runAll ? briefs : briefs.slice(0, 1);
const model = modelIdFor("planner");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * A source URL that 404s is not a source. A 403 usually means the site blocks
 * unknown user agents, not that the page is gone — treat it as reachable, and
 * present as a browser so fewer sites bother.
 */
async function isLive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
    });
    return res.status < 400 || res.status === 403 || res.status === 405 || res.status === 429;
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
    model: modelFor("judge"),
    schema: verdictSchema,
    prompt: [
      "You are auditing a wedding-vendor research result. Judge only what is asserted here.",
      `Region the couple is searching: ${region}`,
      `Category: ${f.category}`,
      `Business name: ${f.name}`,
      `Website: ${f.website ?? "(none given)"}`,
      `Source: ${f.sourceUrl ?? "(none given)"}`,
      `Stated location: ${f.location ?? "(none given)"}${f.distanceNote ? ` — ${f.distanceNote}` : ""}`,
      `Price signal: ${f.priceSignal ?? "(none)"}`,
      "Two independent questions:",
      "1. real — is this a real, currently-operating business of that category? A placeholder, " +
        "an invented-sounding name with no website, or a defunct business fails.",
      "2. serves_region — is the business located INSIDE the couple's stated travel radius? " +
        "Reason about the actual drive: anything within the stated radius passes, including at " +
        "the edge of it. Fail only when the business is clearly outside — a different state, or " +
        "a drive well beyond what they said they would travel. Do not fail a business for being " +
        "in a different town; that is the point of a radius.",
    ].join("\n"),
  });
  return object;
}

const results: EvalCaseResult[] = [];
/**
 * Briefs whose specialists were dispatched and never went quiet inside
 * EVAL_SETTLE_TIMEOUT_MS. Grading one of those measures timing, not research
 * quality, so the summary it produces is published without a score.
 *
 * A brief where nothing was ever dispatched does not belong here. That run is
 * not unmeasurable, it is measured and bad, and unscoring it published a dead
 * agent under the same muted "not scored" chip a merely slow one earns — and,
 * because this list is global, unscored every other brief in the run with it.
 */
const unsettled: string[] = [];
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
  let delegated = 0;
  // Venus may spend the first turn confirming the brief before she fans out.
  // A research eval should grade the research, not punish one extra pleasantry,
  // so nudge up to MAX_TURNS times until specialists actually start.
  const MAX_TURNS = 3;
  const messages = [
    brief.message,
    "That's everything — please start the research now.",
    "Go ahead and start researching, I have nothing else to add.",
  ];
  try {
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const response = await session.send({
        message: messages[turn] ?? messages[messages.length - 1],
        signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
      });
      sessionId = response.sessionId ?? sessionId;
      if (turn === 0) console.log(`session ${sessionId}`);
      const result = await response.result();
      status = result.status;
      // eve 0.24.4 does not deliver `subagent.called` on the parent stream, so
      // counting it here made this eval think nothing was delegated and
      // re-prompt — triggering a whole extra fan-out per nudge. Count the
      // delegation request instead, where it is actually observable.
      delegated += result.events
        .filter((e) => e.type === "actions.requested")
        .reduce(
          (n, e) =>
            n +
            (((e.data as { actions?: readonly unknown[] }).actions ?? []) as readonly {
              kind?: string;
            }[]).filter((a) => a?.kind === "subagent-call").length,
          0,
        );
      console.log(`  turn ${turn + 1}: ${status} · ${delegated} specialists so far`);
      if (delegated > 0 || status === "failed") break;
    }
  } catch (error) {
    status = `error: ${String((error as Error)?.message ?? error).slice(0, 120)}`;
  }
  const seconds = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`turn ${status} in ${seconds}s`);

  if (!sessionId) {
    note(false, `${brief.id} · turn`, "a completed planning turn", status);
    continue;
  }

  // The parent turn settles as soon as Venus has dispatched her scouts — she
  // parks while they work. Grading here measured a run in flight and scored
  // "0 recorded" against specialists that were still searching. Wait for the
  // tree to go quiet before reading anything.
  //
  // Only a tree that exists can go quiet. A fan-out that never happened is not
  // an unmeasurable run, it is the agent failing at the only job it has, and
  // sending it down this wait cost twice: ~48 KV polls to confirm an emptiness
  // already known, then a "not scored" chip that hid a dead agent behind the
  // label a merely slow one earns. Decide dispatch first.
  //
  // Two reads rather than one, because the reverse mistake is as bad: the
  // parent stream is the weaker witness (eve 0.24.4 never delivers
  // `subagent.called`, which is why `delegated` is counted off the request),
  // and a child that started a moment ago may not have reached KV yet.
  let seenInTree = 0;
  if (delegated === 0) {
    for (let probe = 0; probe < 2 && seenInTree === 0; probe += 1) {
      if (probe > 0) await new Promise((r) => setTimeout(r, 15_000));
      seenInTree = (await getTraceTree(sessionId).catch(() => null))?.children.length ?? 0;
    }
  }
  const dispatched = delegated > 0 || seenInTree > 0;

  let settled = false;
  if (dispatched) {
    const settleDeadline = Date.now() + SPECIALIST_SETTLE_MS;
    for (;;) {
      const snapshot = await getTraceTree(sessionId).catch(() => null);
      const kids = snapshot?.children ?? [];
      // Finished, not merely not-running — the definition agent/tools/get_research.ts
      // uses. A specialist parked on an input gate is `waiting`, and reading that as
      // done grades a scout that has not searched yet.
      const unfinished = kids.filter((c) => c.status !== "completed" && c.status !== "failed");
      // A child joins the tree only once its own session starts, and the first poll
      // runs before the 15s sleep. Counting only what had registered declared a
      // five-scout fan-out settled on the two children that had appeared and
      // finished, and that partial run was published as a real score.
      const allRegistered = kids.length >= Math.max(delegated, seenInTree);
      if (kids.length > 0 && allRegistered && unfinished.length === 0) {
        settled = true;
        console.log(`  specialists settled (${kids.length}/${Math.max(delegated, seenInTree)})`);
        break;
      }
      if (Date.now() > settleDeadline) {
        console.log(
          `  gave up waiting: ${kids.length}/${Math.max(delegated, seenInTree)} registered, ` +
            `${unfinished.length} unfinished after ${SPECIALIST_SETTLE_MS / 1000}s`,
        );
        break;
      }
      const recorded = kids.reduce((n, c) => n + c.vendorsRecorded, 0);
      console.log(
        `  waiting on ${unfinished.length}/${kids.length} specialists · ` +
          `${Math.max(delegated, seenInTree)} dispatched · ${recorded} vendors so far`,
      );
      await new Promise((r) => setTimeout(r, 15_000));
    }
    // Only an in-flight tree is unmeasurable. Everything else gets a number.
    if (!settled) unsettled.push(brief.id);
  } else {
    console.log(`  no specialist was ever dispatched in ${MAX_TURNS} turns — nothing to wait for`);
  }
  // `waiting` is the healthy end of this turn: Venus parks the moment she has
  // dispatched her scouts. Labelling the expectation "completed" published a row
  // reading expected "completed" · got "waiting (32s)" · PASS on every green run —
  // a dashboard contradicting itself in public. Wording taken from scripts/grade.ts
  // so the two graders read alike on /observe.
  note(
    status !== "unknown" && !status.startsWith("error"),
    `${brief.id} · turn`,
    "the run settled",
    `${status} (${seconds}s)`,
  );
  note(
    dispatched,
    `${brief.id} · dispatch`,
    ">=1 specialist dispatched",
    dispatched ? `${Math.max(delegated, seenInTree)} dispatched` : `none in ${MAX_TURNS} turns`,
  );

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

    const fromDirectory = list.filter((f) => f.sourceUrl && directoryHost(f.sourceUrl));
    note(
      fromDirectory.length === 0,
      `${brief.id} · ${category} · own-site sources`,
      "no directory listings recorded as sources",
      fromDirectory.length === 0 ? "clean" : `${fromDirectory.length} from directories`,
      fromDirectory.map((f) => f.name).slice(0, 2).join(", ") || undefined,
    );

    const foreignEmails = list.filter(
      (f) =>
        f.inquiryEmail &&
        !isContactFormOnly(f.inquiryEmail) &&
        emailLooksForeign(f.inquiryEmail, f.website, f.name),
    );
    note(
      foreignEmails.length === 0,
      `${brief.id} · ${category} · emails belong to the vendor`,
      "no addresses from unrelated domains",
      foreignEmails.length === 0 ? "clean" : `${foreignEmails.length} suspicious`,
      foreignEmails.map((f) => `${f.name}: ${f.inquiryEmail}`).slice(0, 2).join(" | ") || undefined,
    );

    const located = list.filter((f) => (f.location ?? "").trim().length > 1);
    note(
      located.length === list.length,
      `${brief.id} · ${category} · location recorded`,
      "every vendor states its town",
      `${located.length}/${list.length}`,
      list
        .filter((f) => !(f.location ?? "").trim())
        .map((f) => f.name)
        .slice(0, 2)
        .join(", ") || undefined,
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
    let inRegionCount = 0;
    const notReal: string[] = [];
    const outOfRange: string[] = [];
    for (const f of sample) {
      try {
        const v = await judgeVendor(f, brief.region);
        if (v.real) realCount += 1;
        else notReal.push(`${f.name}: ${v.reason}`);
        if (v.serves_region) inRegionCount += 1;
        else outOfRange.push(`${f.name} (${f.location ?? "?"}): ${v.reason}`);
      } catch (error) {
        notReal.push(`${f.name}: judge failed (${String((error as Error)?.message).slice(0, 60)})`);
      }
    }
    // Two independent failures with very different severity: an invented
    // vendor is a fabrication, a vendor 20 minutes past the radius is a
    // judgement call. Scoring them as one number hid which was happening.
    note(
      realCount === sample.length,
      `${brief.id} · ${category} · real businesses (judge)`,
      "every sampled vendor is a real, operating business",
      `${realCount}/${sample.length}`,
      notReal.slice(0, 2).join(" | ") || undefined,
    );
    note(
      inRegionCount === sample.length,
      `${brief.id} · ${category} · within travel radius (judge)`,
      "every sampled vendor is inside the stated radius",
      `${inRegionCount}/${sample.length}`,
      outOfRange.slice(0, 2).join(" | ") || undefined,
    );
  }
}

const passed = results.filter((r) => r.ok).length;
const score = results.length ? passed / results.length : 0;
console.log(
  `\nscout quality ${passed}/${results.length} = ${(score * 100).toFixed(0)}% · agent ${model} · judge ${modelIdFor("judge")}`,
);
if (unsettled.length) {
  console.log(
    `NOT A SCORE — specialists never settled on ${unsettled.join(", ")}. ` +
      "Published unscored; re-run before quoting this number.",
  );
}

if (traceConfigured()) {
  await saveEvalSummary({
    kind: "scout",
    name: "Research quality (scout specialists: coverage, contactability, live sources, real vendors)",
    ranAt: new Date().toISOString(),
    model,
    judgeModel: modelIdFor("judge"),
    n: results.length,
    passed,
    score,
    cases: results,
    langsmith: null,
    note: `${selected.length} brief${selected.length === 1 ? "" : "s"} against ${host}`,
    incomplete: unsettled.length
      ? `specialists never settled on ${unsettled.join(", ")} within ${SPECIALIST_SETTLE_MS / 1000}s — ` +
        "these checks graded a run still in flight, so this is a reading of timing, not of research quality"
      : null,
  });
  console.log("saved to KV → /observe");
} else {
  console.log("KV not configured — summary not saved.");
}
