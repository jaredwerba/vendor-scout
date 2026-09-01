import { defineTool } from "eve/tools";
import { z } from "zod";
import { countSearches, filterSeen, searchCapFor } from "../lib/search-budget";

/**
 * Our own web search, replacing Eve's built-in `web_search` by filename.
 *
 * The built-in is provider-managed (the model vendor's servers run the
 * search), which couples the agent's research ability to whichever model is
 * plugged in — Anthropic models have it, meta/muse-spark does not. Backing
 * search with Tavily makes the capability model-independent: swap brains
 * freely, research keeps working.
 *
 * Accepts a BATCH of queries, and that is the point of the tool's shape.
 * A measured scout run spent 166 seconds of 220 deciding what to call next
 * and only 27 actually running tools: the cost of research here is the model
 * round trip, not the search. Every extra round trip re-reads a transcript
 * that has grown since the last one, so the thinking gets slower as the run
 * goes on. Four queries in one call cost one round trip; four calls cost
 * four.
 *
 * The scout instructions asked for this batching before the tool could
 * express it, which made it a request the model could quietly ignore. Taking
 * an array makes it structural — the model has to decide how many angles to
 * cover before it commits, which is also the better research habit.
 */

const TAVILY_KEY = process.env.TAVILY_API_KEY;

/** Beyond four, a batch is guessing rather than covering angles. */
const MAX_BATCH = 4;

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
};

type Hit = {
  title: string;
  url: string;
  snippet: string;
  published?: string;
  /** Which query in the batch produced this. Stripped before returning. */
  q: number;
};

type Outcome =
  | { query: string; ok: true; hits: Hit[]; images: string[] }
  | { query: string; ok: false; error: string };

/**
 * One Tavily call, retrying ONLY transient failures, with jitter. A 429 or a
 * 5xx is the provider asking us to wait; a 4xx is us being wrong, and
 * retrying it just spends the couple's search budget on the same mistake. A
 * retried search also must not be charged twice against the budget — the
 * whole batch was counted once, before any of this ran.
 */
async function searchOne(
  query: string,
  index: number,
  opts: {
    max_results?: number;
    include_images?: boolean;
    time_range?: string;
    topic?: string;
  },
): Promise<Outcome> {
  const body = JSON.stringify({
    query,
    max_results: opts.max_results ?? 6,
    // "advanced" when freshness matters: Tavily re-ranks for relevance and
    // honours the time window more tightly (2 credits instead of 1).
    search_depth: opts.time_range ? "advanced" : "basic",
    include_answer: false,
    include_images: opts.include_images ?? false,
    ...(opts.time_range ? { time_range: opts.time_range } : {}),
    ...(opts.topic ? { topic: opts.topic } : {}),
  });

  let res: Response | null = null;
  let lastError = "";
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      // Rate limits get a real pause: 1.2s of total backoff cannot outlive a
      // 429 window, and a 4-wedding parallel run showed what that costs — two
      // plans' scouts finished with nothing. ~2.5s/5s waits usually can.
      const base = lastStatus === 429 ? 2500 : 400;
      const backoff = base * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoff));
    }
    try {
      res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          authorization: `Bearer ${TAVILY_KEY}`,
          "content-type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      // A timeout or a dropped socket is transient by definition.
      lastError = String((error as Error)?.message ?? error).slice(0, 160);
      res = null;
      continue;
    }
    if (res.ok) break;
    const transient = res.status === 429 || res.status >= 500;
    if (!transient) break;
    lastStatus = res.status;
    lastError = `HTTP ${res.status}`;
  }

  if (!res || !res.ok) {
    const detail = res ? await res.text().catch(() => "") : lastError;
    return {
      query,
      ok: false,
      error: res
        ? `HTTP ${res.status}. ${String(detail).slice(0, 160)}`
        : `unreachable after 3 attempts (${lastError})`,
    };
  }

  const json = (await res.json().catch(() => ({}))) as {
    results?: TavilyResult[];
    images?: (string | { url?: string })[];
  };
  return {
    query,
    ok: true,
    images: (json.images ?? [])
      .map((i) => (typeof i === "string" ? i : (i.url ?? "")))
      .filter((u) => u.startsWith("https://"))
      .slice(0, 8),
    hits: (json.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.content ?? "").slice(0, 600),
      ...(r.published_date ? { published: r.published_date } : {}),
      q: index,
    })),
  };
}

export default defineTool({
  description:
    "Search the web. Pass THREE OR FOUR queries in `queries` and they run at the same time for " +
    "the price of one round trip — different angles on the same category, or different towns " +
    "near the couple. This is the single biggest thing you control about how long the couple waits. " +
    "Use focused queries (vendor type + location + style) and refine based on results.",
  inputSchema: z.object({
    queries: z
      .array(z.string().min(3).max(300))
      .min(1)
      .max(MAX_BATCH)
      .optional()
      .describe(
        `Up to ${MAX_BATCH} search queries, run concurrently. Prefer 3-4 covering different ` +
          "angles over one query at a time — same cost in searches, a quarter of the waiting.",
      ),
    query: z
      .string()
      .min(3)
      .max(300)
      .optional()
      .describe("A single search query. Prefer `queries` unless you genuinely have only one."),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("How many results to return per query (default 6)."),
    include_images: z
      .boolean()
      .optional()
      .describe(
        "Also return image URLs related to each query. Use for venue photo hunts, e.g. query '<venue name> wedding venue'.",
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
  async execute({ queries, query, max_results, include_images, time_range, topic }, ctx) {
    // The key check comes first: a call that can never reach Tavily must not
    // spend the budget. With no key, counting first burned all 25 on calls
    // that did nothing and then reported the cap as spent.
    if (!TAVILY_KEY) {
      return {
        status: "not_configured",
        note:
          "Web search is not configured on this deployment (missing TAVILY_API_KEY). " +
          "Tell the couple you currently can't search the web, and answer only from " +
          "pages you can fetch directly or information they provide. Do not guess.",
      };
    }

    // Both fields are optional so that neither shape can ever be a SCHEMA
    // failure. A schema the model cannot satisfy kills the call — and on a
    // subagent, the whole session. An empty batch is recoverable: say so and
    // let it try again.
    const wanted = (queries?.length ? queries : query ? [query] : [])
      .map((q) => q.trim())
      .filter((q) => q.length >= 3)
      .slice(0, MAX_BATCH);

    if (wanted.length === 0) {
      return {
        status: "no_query",
        note: "Pass `queries` (up to 4 strings) or a single `query`. Nothing was searched.",
      };
    }

    // Retrieval governance: a specialist gets a research budget, the root a
    // larger one. Exhausting it is a normal outcome, not a failure — the
    // model is told to conclude from what it already has.
    const budget = countSearches(wanted.length, searchCapFor(Boolean(ctx.session.parent)));
    if (budget.exhausted) {
      return {
        status: "cap_reached",
        used: budget.used,
        cap: budget.cap,
        note:
          `Search budget for this agent is spent (${budget.cap} searches). Do NOT search again. ` +
          "Finish with what you already found: record or report every vendor you verified, " +
          "and say plainly which parts you could not cover.",
      };
    }

    // A batch that crosses the cap runs the part the budget covers.
    const ran = wanted.slice(0, budget.granted);
    const dropped = wanted.slice(budget.granted);

    const outcomes = await Promise.all(
      ran.map((q, i) => searchOne(q, i, { max_results, include_images, time_range, topic })),
    );

    // Overlapping queries return the same pages — that is the normal case for
    // a batch, and the reason dedupe runs across the WHOLE batch rather than
    // per query. A repeat is re-billed on every later step because the
    // transcript re-sends it.
    const all = outcomes.flatMap((o) => (o.ok ? o.hits : []));
    const { fresh, suppressed } = filterSeen(all);
    const byQuery = new Map<number, Omit<Hit, "q">[]>();
    for (const { q, ...hit } of fresh) {
      const list = byQuery.get(q) ?? [];
      list.push(hit);
      byQuery.set(q, list);
    }

    const searches = outcomes.map((o, i) =>
      o.ok
        ? {
            query: o.query,
            results: byQuery.get(i) ?? [],
            ...(o.images.length ? { images: o.images } : {}),
          }
        : { query: o.query, error: o.error, results: [] },
    );
    const failed = outcomes.filter((o) => !o.ok).length;

    return {
      // Every query failing is a failure; some failing is a partial result the
      // model can still work from.
      status: failed === outcomes.length ? "search_failed" : "ok",
      searches_used: budget.used,
      searches_left: Math.max(0, budget.cap - budget.used),
      ...(time_range ? { time_range } : {}),
      ...(suppressed > 0 ? { already_seen: suppressed } : {}),
      ...(dropped.length
        ? {
            not_run: dropped,
            note: `Only ${budget.granted} of ${wanted.length} queries fit in the remaining budget.`,
          }
        : {}),
      ...(failed > 0 && failed < outcomes.length
        ? { partial: `${failed} of ${outcomes.length} queries failed; the rest returned.` }
        : {}),
      searches,
    };
  },
});
