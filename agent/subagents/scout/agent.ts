import { defineAgent } from "eve";
import { contextWindowFor, modelFor } from "../../lib/models";

/**
 * The research specialist.
 *
 * Venus used to fan out with eve's built-in `agent` tool, which runs a copy of
 * the root agent — same instructions, same tools, including `send_outreach`.
 * A researcher that *can* email a vendor is one bad inference away from doing
 * it. This is a declared subagent instead: it inherits nothing, and its whole
 * tool surface is web search plus recording what it found. It cannot contact
 * anyone, because the capability is not there.
 *
 * Declared subagents inherit nothing at all, so the disabled shell tools and
 * the observability hook are re-authored under this directory.
 */

export default defineAgent({
  description:
    "Researches ONE wedding-vendor category (venue, photography, catering, florals, music, " +
    "styling) against a couple's brief and budget, and returns 3-4 real, currently-operating " +
    "vendors with published contact details, price signals and source links. Reads the web " +
    "only — it never contacts a vendor.",
  // A specialist runs a different model from the planner on purpose: its cost
  // is dominated by input tokens across a long tool loop, not by prose
  // quality. See agent/lib/models.ts.
  model: modelFor("scout"),
  modelContextWindowTokens: contextWindowFor("scout"),
  // NO outputSchema, deliberately.
  //
  // It was here to guarantee a structured return, and it became the single
  // most brittle thing in the specialist tier: eve escalates a schema the
  // model cannot produce to OUTPUT_SCHEMA_NOT_FULFILLED, which fails the
  // whole child session. A run with DeepSeek-V4-Flash killed 10 of 10
  // specialists that way, several before they had searched even once.
  //
  // The guarantee was also redundant. Findings reach the planner through
  // `record_vendor` and the KV research store, which `get_research` reads —
  // never through the child's return value. So the schema bought nothing and
  // could cost everything. A scout now reports back in prose, and what
  // matters is already durably written down.
  // Same launch directive as the root: a couple mid-planning never hits a
  // meter. Runaway protection is the search budget (lib/search-budget.ts),
  // not a token gate that pauses a child nobody can answer.
  limits: {
    maxInputTokensPerSession: false,
    maxOutputTokensPerSession: false,
  },
});
