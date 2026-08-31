import { defineTool } from "eve/tools";
import { z } from "zod";
import { curatedConfigured, saveCuratedWedding } from "../lib/curated";

/**
 * Archives a finished three-option plan into "Curated by Venus" (/curated) —
 * the couple's brief plus the full presentation, exactly as shown. Called
 * once per plan, right after the three options are presented. No approval:
 * it only writes to the app's own gallery behind the same access gate.
 */
export default defineTool({
  description:
    "Save the couple's wedding plan into the Curated by Venus gallery. Call this once the " +
    "complete plan (chosen venue + curated slate) is composed, BEFORE streaming it to the " +
    "couple, passing the COMPLETE plan markdown verbatim (images, tables, every word). " +
    "Use the couple's first name only.",
  inputSchema: z.object({
    title: z
      .string()
      .min(4)
      .max(90)
      .describe("Evocative gallery title, e.g. 'A Boho Farm Evening North of Boston'."),
    first_name: z.string().min(1).max(40).describe("Couple's first name(s) only — never full names."),
    budget_usd: z.number().int().min(1000).describe("Their stated total budget."),
    location: z.string().min(2).max(90).describe("Region, e.g. 'Methuen, MA area'."),
    season: z.string().min(2).max(60).describe("Season or date window, e.g. 'September 2027'."),
    guest_count: z.string().min(1).max(30).describe("e.g. '~50'."),
    style: z.string().min(2).max(90).describe("The vibe in a few words, e.g. 'boho, outdoorsy'."),
    brief_summary: z
      .string()
      .min(20)
      .max(600)
      .describe("2-3 sentence summary of what the couple asked for, in Venus's voice."),
    plan_markdown: z
      .string()
      .min(200)
      .describe(
        "The COMPLETE plan presentation, BYTE-FOR-BYTE as it will be shown to the couple — " +
          "every image line, every financial breakdown table, every word. Never summarize or omit.",
      ),
    hero_image_url: z
      .string()
      .url()
      .optional()
      .describe("The single best venue image URL from the plan (https)."),
    // Everything below is wanted but must NEVER block an archive — a save
    // that fails validation can wedge the whole flow, and archiving is
    // strictly less important than the couple's wedding moving forward.
    image_urls: z
      .array(z.string().url())
      .optional()
      .default([])
      .describe("EVERY venue photo URL used across all three options."),
    tier_totals: z
      .object({
        ultra_luxe: z.number().int(),
        elevated: z.number().int(),
        intimate: z.number().int(),
      })
      .optional()
      .describe("Legacy three-tier flow only — OMIT for a curated slate plan."),
    research_markdown: z
      .string()
      .optional()
      .describe(
        "Your specialists' COMPLETE findings as markdown: for each category, every vendor " +
          "considered (not just the winners) with price signal, what's included, style fit, " +
          "standout/caveat, and source link. This is the full research record.",
      ),
  }),
  async execute(input) {
    if (!curatedConfigured()) {
      return { status: "not_configured", note: "Gallery store isn't set up — plan not archived." };
    }
    const rec = await saveCuratedWedding({
      ...input,
      hero_image_url: input.hero_image_url ?? input.image_urls?.[0] ?? null,
    });
    return {
      status: "saved",
      id: rec.id,
      gallery_path: `/curated/${rec.id}`,
      note:
        "Archived to Curated by Venus. NOW deliver it: stream the COMPLETE plan to the couple " +
        "in this same turn — the venue, every pick, every photo line, the full cost table, " +
        "word for word — then end the turn with the ask_question tool: want me to send these " +
        "inquiries? Options: Send them all / Swap a pick first / Hold off for now. The gallery " +
        "is the archive; the chat message is the product.",
    };
  },
});
