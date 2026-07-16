import { defineTool } from "eve/tools";
import { z } from "zod";

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
  }),
  async execute({ query, max_results }) {
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
        search_depth: "basic",
        include_answer: false,
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

    const json = (await res.json()) as { results?: TavilyResult[] };
    return {
      status: "ok",
      query,
      results: (json.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 600),
      })),
    };
  },
});
