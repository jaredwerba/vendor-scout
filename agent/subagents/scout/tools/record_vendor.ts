import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordVendor, researchConfigured } from "../../../lib/research";

/**
 * Write down one verified vendor, immediately.
 *
 * This is the difference between research that survives and research that
 * evaporates. A specialist that returns everything in one closing message
 * loses the whole category to a truncated reply, a provider hiccup or a
 * cancelled turn — and loses it silently. Recording per vendor means partial
 * progress is real progress, and "recorded 0" is a signal the planner can act
 * on rather than an empty result it cannot distinguish from "found nothing".
 *
 * Findings are filed under the ROOT session, so the planner (and the live
 * console) can read them while the specialist is still working.
 */
export default defineTool({
  description:
    "Record ONE verified vendor you just found. Call this immediately after verifying each " +
    "vendor, before researching the next one — never batch them at the end. Recording the " +
    "same name twice updates that entry rather than duplicating it.",
  inputSchema: z.object({
    category: z
      .string()
      .min(3)
      .max(40)
      .describe("The CATEGORY from the first line of your brief, exactly as written."),
    name: z.string().min(2).max(120).describe("Exact business name."),
    website: z.string().max(300).optional().describe("Their own site (https)."),
    inquiry_email: z
      .string()
      .max(200)
      .optional()
      .describe("A PUBLISHED address, or the literal 'contact form only'. Never guess one."),
    price_signal: z
      .string()
      .max(300)
      .optional()
      .describe("What their site actually says, or 'not listed'. Never estimate."),
    includes: z.string().max(600).optional().describe("What the package covers."),
    style_fit: z.string().max(400).optional().describe("Why this fits THIS brief, in one line."),
    caveat: z.string().max(400).optional().describe("The one thing that might rule it out."),
    source_url: z.string().max(300).optional().describe("Where you read it."),
    image_urls: z
      .array(z.string().max(500))
      .max(8)
      .optional()
      .describe("Venues only: 5-7 absolute https photos of THIS venue."),
  }),
  async execute(input, ctx) {
    if (!researchConfigured()) {
      return {
        status: "not_configured",
        note:
          "The research store is unavailable on this deployment. Keep going and include this " +
          "vendor in your final structured report instead.",
      };
    }
    // Findings belong to the wedding, not to this child session.
    const rootSessionId = ctx.session.parent?.rootSessionId ?? ctx.session.id;
    const images = (input.image_urls ?? []).filter((u) => u.startsWith("https://"));
    try {
      const { total } = await recordVendor(rootSessionId, {
        category: input.category,
        name: input.name,
        website: input.website ?? null,
        inquiryEmail: input.inquiry_email ?? null,
        priceSignal: input.price_signal ?? null,
        includes: input.includes ?? null,
        styleFit: input.style_fit ?? null,
        caveat: input.caveat ?? null,
        sourceUrl: input.source_url ?? null,
        imageUrls: images,
        bySession: ctx.session.id,
      });
      return {
        status: "recorded",
        name: input.name,
        category: input.category,
        recorded_in_category: total,
        note:
          total >= 4
            ? "You have enough for this category — finish your report."
            : "Recorded. Research the next vendor.",
      };
    } catch (error) {
      return {
        status: "record_failed",
        note:
          "Could not save that vendor. Keep it in your final report so it is not lost, and " +
          "carry on with the next one.",
        detail: String((error as Error)?.message ?? error).slice(0, 200),
      };
    }
  },
});
