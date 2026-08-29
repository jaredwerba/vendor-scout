import { defineTool } from "eve/tools";
import { z } from "zod";
import { countSearch, searchCapFor } from "../lib/search-budget";

/**
 * Our own web search, replacing Eve's built-in `web_search` by filename.
 *
 * The built-in is provider-managed (the model vendor's servers run the
 * search), which couples the agent's research ability to whichever model is
 * plugged in — Anthropic models have it, meta/muse-spark does not. Backing
 * search with Tavily makes the capability model-independent: swap brains
 * freely, research keeps working.
 */

const TAVILY_KEY = process.env.TAVILY_API_KEY;

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
};

export default defineTool({
  description:
    "Search the web. Returns titles, URLs, and content snippets for the query. " +
    "Use focused queries (vendor type + location + style) and refine based on results.",
  inputSchema: z.object({
    query: z.string().min(3).max(300).describe("The search query."),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("How many results to return (default 6)."),
    include_images: z
      .boolean()
      .optional()
      .describe(
        "Also return image URLs related to the query. Use for venue photo hunts, e.g. query '<venue name> wedding venue'.",
      ),
    time_range: z
      .enum(["day", "week", "month", "year"])
      .optional()
      .describe(
        "Only return pages published within this window. Use for anything that goes stale — " +
          "current pricing, availability, 'this season' packages, news about a vendor.",
      ),
    topic: z
      .enum(["general", "news"])
      .optional()
      .describe("'news' searches recent news sources only; default 'general'."),
  }),
  async execute({ query, max_results, include_images, time_range, topic }, ctx) {
    // Retrieval governance: a specialist gets a research budget, the root a
    // larger one. Exhausting it is a normal outcome, not a failure — the
    // model is told to conclude from what it already has.
    const budget = countSearch(searchCapFor(Boolean(ctx.session.parent)));
    if (budget.exhausted) {
      return {
        status: "cap_reached",
        used: budget.used - 1,
        cap: budget.cap,
        note:
          `Search budget for this agent is spent (${budget.cap} searches). Do NOT search again. ` +
          "Finish with what you already found: record or report every vendor you verified, " +
          "and say plainly which parts you could not cover.",
      };
    }

    if (!TAVILY_KEY) {
      return {
        status: "not_configured",
        note:
          "Web search is not configured on this deployment (missing TAVILY_API_KEY). " +
          "Tell the couple you currently can't search the web, and answer only from " +
          "pages you can fetch directly or information they provide. Do not guess.",
      };
    }

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TAVILY_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: max_results ?? 6,
        // "advanced" when freshness matters: Tavily re-ranks for relevance and
        // honours the time window more tightly (2 credits instead of 1).
        search_depth: time_range ? "advanced" : "basic",
        include_answer: false,
        include_images: include_images ?? false,
        ...(time_range ? { time_range } : {}),
        ...(topic ? { topic } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        status: "search_failed",
        note: `Search provider returned ${res.status}. Try a reworded query, or fall back to web_fetch on known sites.`,
        detail: detail.slice(0, 300),
      };
    }

    const json = (await res.json()) as {
      results?: TavilyResult[];
      images?: (string | { url?: string })[];
    };
    const images = (json.images ?? [])
      .map((i) => (typeof i === "string" ? i : (i.url ?? "")))
      .filter((u) => u.startsWith("https://"))
      .slice(0, 8);
    return {
      status: "ok",
      query,
      searches_used: budget.used,
      searches_left: Math.max(0, budget.cap - budget.used),
      ...(time_range ? { time_range } : {}),
      results: (json.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 600),
        ...(r.published_date ? { published: r.published_date } : {}),
      })),
      ...(images.length ? { images } : {}),
    };
  },
});
