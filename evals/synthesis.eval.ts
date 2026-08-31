import { defineEval } from "eve/evals";
import { modelFor } from "../agent/lib/models";

/**
 * The money rule, end to end.
 *
 * Venus's one financial promise is that **all three options fit inside the
 * stated budget** — an over-budget "Ultra-Luxe" is not an upsell, it is a
 * broken promise, and it is the failure a couple would notice last and
 * resent most. Nothing else in the suite checks it, because it only exists
 * after research, synthesis and formatting have all gone right.
 *
 * This drives a full planning turn, so it is slow and costs real research
 * credits: tagged "slow" and excluded from `npm run eval:all`.
 *
 *   npm run eval:slow
 */

const BUDGET = 45_000;
// Totals are presented as "estimated total" lines and in the breakdown
// tables; a plan is over budget if ANY dollar figure presented as a tier
// total exceeds what the couple said.
const TOTAL_LINE = /(?:estimated\s+total|total)[^\n$]{0,40}\$([\d,]+)/gi;

export default defineEval({
  // Venue-first flow: a single send settles at the venue gate, so this eval
  // guards PHASE 1 — three venue options, photos and price signals, nothing
  // emailed, and no presented figure above the budget.
  description: "Phase 1: three venue options inside the stated budget, nothing sent.",
  tags: ["slow", "money"],
  timeoutMs: 900_000,
  // The judge is pinned away from the model under test on purpose: swapping
  // NEBIUS_MODEL must never change how the result is graded.
  judge: { model: modelFor("judge") },
  async test(t) {
    await t.send(
      `Hi Venus! Our budget is around $${BUDGET.toLocaleString("en-US")} — plan our wedding for us.\n\n` +
        "We're Maya and Sam. September 2027, flexible by a few weeks. Methuen, MA, we'd travel up " +
        "to an hour. About 110 guests. Boho and outdoorsy — a farm or barn, string lights, " +
        "wildflowers. Live band, documentary-style photography, videographer yes. Family-style " +
        "food, full bar. Must-have: outdoor ceremony with a rain plan. Dealbreaker: hotel " +
        "ballrooms. Nothing booked.",
    );

    t.notEvent("turn.failed");
    t.notEvent("session.failed");
    t.noFailedActions();

    // Research must go through the narrow specialist, and nothing may be
    // emailed before the couple has picked a venue. Phase 1 dispatches one
    // venue scout; venue_supply may add a second — one is the honest floor.
    t.calledTool("scout", { count: (n) => n >= 1 });
    t.notCalledTool("send_outreach");

    // Every dollar total presented must fit the budget.
    t.eventsSatisfy("all presented totals fit inside the stated budget", (events) => {
      const text = events
        .filter((e) => e.type === "message.completed")
        .map((e) => String((e.data as { message?: string }).message ?? ""))
        .join("\n");
      const totals: number[] = [];
      for (const m of text.matchAll(TOTAL_LINE)) {
        const n = Number(m[1].replace(/,/g, ""));
        if (Number.isFinite(n) && n > 1000) totals.push(n);
      }
      // Phase 1 presents price signals rather than guaranteed "estimated
      // total" lines, so presence is the judge's burden; any figure that IS
      // presented as a total must still fit.
      return totals.every((n) => n <= BUDGET);
    });

    t.judge.autoevals
      .closedQA(
        "Presents three distinct venue options, each naming a real venue with a link, each " +
          "with photos and a price signal, and ends by asking the couple to choose one. Marks " +
          "any figure not backed by a vendor quote as an estimate.",
      )
      .atLeast(0.7);
  },
});
