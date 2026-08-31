import { defineTool } from "eve/tools";
import { z } from "zod";
import { countByCategory, listAllFindings, researchConfigured } from "../lib/research";
import { getTraceTree, isStalled, readCount, STALL_AFTER_MS, toolRuns } from "../lib/trace";

/**
 * Read back everything the specialists have recorded — plus an honest health
 * report on each one.
 *
 * The point is that an empty category is never ambiguous. This joins the
 * findings (agent/lib/research.ts) to the live trace (agent/lib/trace.ts), so
 * the planner can tell "searched properly, nothing fits" from "that
 * specialist was cut off mid-run" and react differently to each.
 */
export default defineTool({
  description:
    "Read everything your research specialists have recorded so far, with a per-specialist " +
    "health check (how many vendors each recorded, and whether any was cut off). Call this " +
    "after your scout calls return, before writing the three options.",
  inputSchema: z.object({
    category: z
      .string()
      .max(40)
      .optional()
      .describe("Limit to one category. Omit for everything."),
  }),
  async execute({ category }, ctx) {
    if (!researchConfigured()) {
      return { status: "not_configured", note: "No research store on this deployment." };
    }
    const rootSessionId = ctx.session.parent?.rootSessionId ?? ctx.session.id;
    const [all, counts, tree] = await Promise.all([
      listAllFindings(rootSessionId),
      countByCategory(rootSessionId),
      getTraceTree(rootSessionId).catch(() => ({ root: null, children: [], langsmithTraceId: null })),
    ]);

    const specialists = tree.children.map((c) => {
      const stalled = isStalled(c);
      const refused = readCount(c.refusedActions);
      // "Settled" means finished, not merely not-running. A specialist parked
      // on an input gate is `waiting`, and telling the planner it gave up
      // makes it fan out a duplicate for a scout that is only paused.
      const settled = c.status === "completed" || c.status === "failed";
      return {
        category: c.label,
        // A specialist that has gone silent is reported as stalled rather than
        // as active, so a hang cannot hold the plan hostage waiting for it.
        status: stalled ? "stalled" : c.status,
        // Searches performed, not calls requested: a call refused at the
        // budget cap never reached Tavily.
        searches: toolRuns(c, "web_search"),
        vendors_recorded: c.vendorsRecorded,
        refused,
        truncated: c.truncations > 0,
        failed_actions: c.failedActions,
        // Order matters. A stalled scout must always hear "do not wait" —
        // that is the whole point of the guard — even when it also had
        // refusals. And a re-run must never be suggested for a scout that is
        // still working, or the planner fans out a duplicate mid-flight.
        note: stalled
          ? `STALLED — no activity for over ${Math.round(STALL_AFTER_MS / 60000)} minutes. ` +
            "Do not wait for it. Use whatever it already recorded and move on."
          : settled && refused >= 3 && c.vendorsRecorded === 0
            ? "Everything it tried to record was REFUSED — directory sources, addresses that do not " +
              "belong to the vendor, or a missing town. Re-run it and tell it to open each vendor's own site."
            : settled && c.truncations > 0
              ? "CUT OFF mid-run — its findings are incomplete. Re-run this category once with a narrower brief."
              : settled && c.vendorsRecorded === 0
                ? "Recorded nothing. Either re-run this category once, or tell the couple it is still open."
                : undefined,
      };
    });

    const stalledCount = specialists.filter((s) => s.status === "stalled").length;
    const findings = category ? { [category]: all[category] ?? [] } : all;
    const total = Object.values(findings).reduce((n, list) => n + list.length, 0);

    // Venue photos are the one finding the presentation cannot be written
    // without, and they used to reach the planner on the scout's return value.
    // That return value is gone (the outputSchema was a single point of
    // failure), so they now arrive only through here — surfaced explicitly
    // rather than buried in a field on one of forty objects.
    const venueImages: Record<string, string[]> = {};
    for (const list of Object.values(all)) {
      for (const f of list) {
        const urls = (f.imageUrls ?? []).filter((u) => u.startsWith("https://"));
        if (urls.length > 0) venueImages[f.name] = urls;
      }
    }
    const withPhotos = Object.keys(venueImages).length;

    // Three tiers need three venues. The Fairlee run recorded two — a
    // 10-minute venue radius the planner had invented — and the third tier
    // quietly re-showed the first tier's venue and photos; the couple
    // noticed. Supply is countable here, at the last read before the
    // options are written, so the shortfall arrives as an instruction
    // instead of being discovered on the gallery page.
    const venueFindings = all.venue ?? [];
    const venuesWithPhotos = venueFindings.filter((f) =>
      (f.imageUrls ?? []).some((u) => u.startsWith("https://")),
    ).length;

    return {
      status: "ok",
      total_vendors: total,
      counts,
      specialists,
      venue_images: venueImages,
      venue_images_note:
        withPhotos > 0
          ? `${withPhotos} vendors have verified photos above. Put ALL of a venue's photos on ONE line under its tier heading — that line becomes the carousel.`
          : "No verified photos were recorded. Run one web_search with include_images per venue before presenting.",
      venue_supply: {
        recorded: venueFindings.length,
        with_photos: venuesWithPhotos,
        note:
          venueFindings.length >= 3
            ? "Enough for three DISTINCT tiers — never feature the same venue in two of them."
            : `Only ${venueFindings.length} in-radius venue(s) recorded — three tiers need three ` +
              "venues. Delegate ONE more venue scout now (same radius, different towns inside it) " +
              "before presenting. If that re-run also comes back thin, a venue may repeat across " +
              "tiers — but say so to the couple plainly, and make the two visions differ in " +
              "everything else.",
      },
      findings,
      stalled_specialists: stalledCount,
      note:
        stalledCount > 0
          ? `${stalledCount} specialist(s) stalled. Proceed with what is recorded; do not wait.`
          : total === 0
          ? "Nothing recorded yet. If your specialists have returned, treat this as a failure to research, not as an empty market."
          : undefined,
    };
  },
});
