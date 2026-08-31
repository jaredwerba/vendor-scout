import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordVendor, researchConfigured } from "../../../lib/research";
import {
  directoryHost,
  emailLooksForeign,
  isContactFormOnly,
  outsideRadius,
  sourceIsMissing,
} from "../../../lib/vendor-guards";

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
    location: z
      .string()
      .min(2)
      .max(80)
      .describe("The vendor's actual town and state, e.g. 'Rowley, MA'. Required."),
    distance_note: z
      .string()
      .max(120)
      .optional()
      .describe(
        "Optional, from your own knowledge of the area, e.g. '~35 min from Methuen'. " +
          "NEVER search for a drive time to fill this in — leave it blank instead.",
      ),
    couple_location: z
      .string()
      .max(80)
      .optional()
      .describe(
        "The couple's town and state EXACTLY as your brief states it, e.g. 'Methuen, MA'. " +
          "Copy it from the brief — do not search for it.",
      ),
    max_drive_minutes: z
      .number()
      .int()
      .min(10)
      .max(600)
      .optional()
      .describe(
        "The travel radius from your brief, in minutes — 'within ~1 hour' is 60. " +
          "Copy it from the brief; omit only if the brief states no radius. Values under 45 " +
          "are tested against 45 — a too-tight radius starves the couple's plan.",
      ),
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

    const source = input.source_url ?? "";
    const dir = source ? directoryHost(source) : null;
    if (dir) {
      return {
        status: "rejected_directory_source",
        note:
          `That source is a ${dir.replace(/\.$/, "")} listing, not ${input.name}'s own site. ` +
          "Open their actual website (search their name plus their town), take the email and " +
          "price signal from there, and record it again with that URL. If they have no site of " +
          "their own, skip them.",
      };
    }
    if (!source.startsWith("https://") && !source.startsWith("http://")) {
      return {
        status: "rejected_missing_source",
        note: "Record the URL on the vendor's own site where you read this. Every finding needs a source.",
      };
    }

    // A vendor in the wrong state is the failure the couple never catches
    // until an email is already out. The model cannot be asked to "remember"
    // the radius — it is asked to state the drive, in writing, per vendor,
    // which makes the violation visible here and in the trace.
    if (!input.location.trim()) {
      return {
        status: "rejected_missing_location",
        note:
          "Record the vendor's actual town and state — you read it on their site. If that town " +
          "is outside the radius the couple gave you, do not record them at all; find someone " +
          "closer. Do not search for a drive time.",
      };
    }

    // The distance rule used to live only in the prompt — "you know roughly
    // where towns are" — and an eval measured what that is worth: 10 of 18
    // sampled vendors out of region, White Mountains venues for a stated
    // hour. The model states the towns (it always did, honestly — that is
    // how the judge caught it); the arithmetic it cannot do happens here.
    // Straight-line miles, not drive time: nothing searches, and every
    // failure to judge falls open. See outsideRadius in lib/vendor-guards.
    const radius = await outsideRadius(
      input.location,
      input.couple_location,
      input.max_drive_minutes,
    );
    if (radius) {
      return {
        status: "rejected_outside_radius",
        note:
          `${input.location.trim()} is ~${radius.miles} miles straight-line from ` +
          `${(input.couple_location ?? "").trim()} — beyond the ~${radius.limitMiles} miles a ` +
          `${radius.minutes}-minute drive covers. The radius is a hard limit: do not ` +
          "record this vendor. Find someone closer, and do not search for drive times. If the " +
          "category is genuinely thin nearby, say so in your report instead.",
      };
    }

    // A page that is definitively gone cannot be the source for a vendor the
    // couple may be emailed about.
    if (await sourceIsMissing(source)) {
      return {
        status: "rejected_dead_source",
        note:
          `${source} returns 404 — that page does not exist. Record the page you actually read ` +
          "on their site (their homepage is fine), or skip this vendor if you cannot reach one.",
      };
    }

    const email = (input.inquiry_email ?? "").trim();
    const isFormOnly = isContactFormOnly(email);
    if (email && !isFormOnly && emailLooksForeign(email, input.website, input.name)) {
      return {
        status: "rejected_foreign_email",
        note:
          `"${email}" does not look like it belongs to ${input.name} — its domain matches ` +
          "neither their name nor their website. A wedding inquiry sent there reaches the wrong " +
          "business. Take the address from their own contact page, or record 'contact form only'.",
      };
    }
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
        location: input.location.trim(),
        distanceNote: input.distance_note?.trim() || null,
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
