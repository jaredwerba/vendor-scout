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
    "Save the wedding plan you just presented into the Curated by Venus gallery. Call this " +
    "EXACTLY ONCE right after presenting the three options, passing the COMPLETE plan markdown " +
    "verbatim (all three options, images, tables). Use the couple's first name only.",
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
      .describe("The COMPLETE three-option presentation markdown, verbatim as shown to the couple."),
    hero_image_url: z
      .string()
      .url()
      .optional()
      .describe("The single best venue image URL from the plan (https)."),
  }),
  async execute(input) {
    if (!curatedConfigured()) {
      return { status: "not_configured", note: "Gallery store isn't set up — plan not archived." };
    }
    const rec = await saveCuratedWedding({
      ...input,
      hero_image_url: input.hero_image_url ?? null,
    });
    return {
      status: "saved",
      id: rec.id,
      gallery_path: `/curated/${rec.id}`,
      note: "Archived to Curated by Venus.",
    };
  },
});
