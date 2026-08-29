import { defineAgent } from "eve";
import { z } from "zod";
import { scoutModel } from "../../lib/nebius";

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

const vendorSchema = z.object({
  name: z.string().describe("Exact business name."),
  website: z.string().nullable(),
  inquiry_email: z.string().nullable().describe("Published address, or 'contact form only'."),
  price_signal: z.string().nullable().describe("Published pricing, or 'not listed'."),
  includes: z.string().nullable(),
  style_fit: z.string().nullable(),
  caveat: z.string().nullable(),
  source_url: z.string().nullable(),
  image_urls: z.array(z.string()).default([]),
});

export default defineAgent({
  description:
    "Researches ONE wedding-vendor category (venue, photography, catering, florals, music, " +
    "styling) against a couple's brief and budget, and returns 3-4 real, currently-operating " +
    "vendors with published contact details, price signals and source links. Reads the web " +
    "only — it never contacts a vendor.",
  model: scoutModel(),
  // Token Factory ids are not in the AI Gateway catalog, so compaction needs
  // the window spelled out. 262144 = Qwen3-235B; a larger model just has room
  // to spare.
  modelContextWindowTokens: 262_144,
  // Task-mode default: even if the parent forgets to pass an outputSchema,
  // the root gets a structured report instead of prose it has to parse.
  outputSchema: z.object({
    category: z.string(),
    vendors: z.array(vendorSchema),
    recorded: z.number().describe("How many record_vendor calls succeeded."),
    coverage_note: z.string().describe("What was searched, and anything left uncovered."),
  }),
  // Same launch directive as the root: a couple mid-planning never hits a
  // meter. Runaway protection is the search budget (lib/search-budget.ts),
  // not a token gate that pauses a child nobody can answer.
  limits: {
    maxInputTokensPerSession: false,
    maxOutputTokensPerSession: false,
  },
});
