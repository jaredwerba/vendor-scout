import Link from "next/link";
import { type EvalSummary, listEvalSummaries, listTraces, type TraceSummary, traceConfigured } from "@/agent/lib/trace";
import { ObserveConsole } from "./observe-client";

export const dynamic = "force-dynamic";

/**
 * The engineering console.
 *
 * The app's own rail shows the current visitor their agents; this page shows
 * *any* session's whole agent tree — Venus plus every research specialist —
 * live if it is running, replayed from the trace store if it is not, with the
 * eval results and the LangSmith link beside it. It is deliberately public:
 * nothing the couple typed is ever written to the trace store (see the
 * redaction rules in agent/lib/trace.ts), so there is nothing here to gate.
 */

function Chip({ tone, children }: { readonly tone: "good" | "warn" | "muted"; readonly children: React.ReactNode }) {
  const tones = {
    good: "bg-secondary text-secondary-foreground",
    warn: "bg-accent text-accent-foreground",
    muted: "border text-muted-foreground",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${tones[tone]}`}>{children}</span>;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function TraceRow({ t }: { readonly t: TraceSummary }) {
  const tone = t.status === "failed" ? "warn" : t.status === "waiting" || t.status === "completed" ? "good" : "muted";
  const tools = Object.entries(t.tools).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return (
    <div className="rounded-2xl border bg-card/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate font-medium text-sm">{t.title ?? "(no message yet)"}</p>
        <Chip tone={tone}>{t.status}</Chip>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">
        {when(t.startedAt)} · {t.turns} turns · {t.steps} model steps · {t.toolCalls} tool calls · {t.subagents} specialists ·{" "}
        {t.inputTokens.toLocaleString("en-US")} in / {t.outputTokens.toLocaleString("en-US")} out tokens
        {t.failedActions ? ` · ${t.failedActions} failed actions` : ""}
      </p>
      {tools.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tools.map(([name, n]) => (
            <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground" key={name}>
              {name} ×{n}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        session <code>{t.id}</code>{t.model ? ` · ${t.model}` : ""}
      </p>
    </div>
  );
}

function EvalCard({ e }: { readonly e: EvalSummary }) {
  const pct = Math.round(e.score * 100);
  return (
    <div className="rounded-2xl border bg-card/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-sm">{e.name}</p>
        <Chip tone={pct >= 80 ? "good" : "warn"}>{pct}% · {e.passed}/{e.n}</Chip>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">
        ran {when(e.ranAt)}{e.model ? ` · ${e.model}` : ""}
        {e.langsmith?.experiment ? ` · LangSmith experiment ${e.langsmith.experiment}` : ""}
        {e.note ? ` · ${e.note}` : ""}
      </p>
      {e.langsmith?.url ? (
        <a className="mt-1 inline-block text-primary text-xs underline" href={e.langsmith.url} rel="noreferrer" target="_blank">
          open in LangSmith →
        </a>
      ) : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="pb-1 pr-3 font-medium">case</th>
              <th className="pb-1 pr-3 font-medium">expected</th>
              <th className="pb-1 pr-3 font-medium">got</th>
              <th className="pb-1 font-medium">result</th>
            </tr>
          </thead>
          <tbody>
            {e.cases.map((c) => (
              <tr className="border-t" key={c.name}>
                <td className="py-1 pr-3">{c.name}</td>
                <td className="py-1 pr-3"><code>{c.expected}</code></td>
                <td className="py-1 pr-3"><code>{c.got}</code></td>
                <td className="py-1">{c.ok ? "✓" : "✗"}{c.note ? ` ${c.note}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function ObservePage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session: initialSessionId } = await searchParams;
  const runtime = {
    model: (process.env.NEBIUS_MODEL ?? "").trim() || "Qwen/Qwen3-235B-A22B-Instruct-2507",
    provider: "Nebius Token Factory",
    tracing: Boolean(process.env.LANGSMITH_API_KEY),
    project: process.env.LANGSMITH_PROJECT ?? "venus",
  };
  const kv = traceConfigured();
  const [traces, evals] = await Promise.all([
    kv ? listTraces(25).catch(() => [] as TraceSummary[]) : Promise.resolve([] as TraceSummary[]),
    kv ? listEvalSummaries().catch(() => [] as EvalSummary[]) : Promise.resolve([] as EvalSummary[]),
  ]);

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link className="venus-script text-5xl text-primary leading-none" href="/">
            Venus
          </Link>
          <h1 className="venus-serif text-2xl">Under the hood</h1>
          <p className="max-w-md text-muted-foreground text-sm leading-relaxed">
            Every plan is an agent loop — plan, act, observe, decide — running on a model, tools,
            and memory, under a control plane that traces and evaluates it. Venus fans out one
            research specialist per category; each gets its own session, its own tool budget and
            its own lane below.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-1.5">
            <Chip tone="good">model · {runtime.provider}</Chip>
            <Chip tone="muted">{runtime.model}</Chip>
            <Chip tone={runtime.tracing ? "good" : "warn"}>
              {runtime.tracing ? `LangSmith tracing on · ${runtime.project}` : "LangSmith tracing off (no LANGSMITH_API_KEY)"}
            </Chip>
            <Chip tone={kv ? "good" : "warn"}>{kv ? "trace store: Upstash KV" : "trace store: not configured"}</Chip>
          </div>
        </header>

        <section className="mb-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="venus-serif text-lg">Live agent tree</h2>
            <span className="text-muted-foreground text-xs">root + every specialist</span>
          </div>
          <ObserveConsole
            initialSessionId={initialSessionId ?? null}
            runtime={runtime}
            sessions={traces}
          />
        </section>

        <section className="mb-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="venus-serif text-lg">Evals</h2>
            <span className="text-muted-foreground text-xs">
              <code>npm run eval:all</code>
            </span>
          </div>
          {evals.length === 0 ? (
            <div className="venus-texture rounded-3xl border bg-card p-6 text-center">
              <p className="venus-serif text-lg">No eval has run yet.</p>
              <p className="mt-1.5 text-muted-foreground text-sm">
                <code>npm run eval:replies</code> scores vendor-reply understanding (and files a LangSmith
                experiment when a key is set); <code>npm run eval</code> drives the live agent through eve's evals.
              </p>
            </div>
          ) : (
            <div className="space-y-3">{evals.map((e) => <EvalCard e={e} key={e.kind} />)}</div>
          )}
        </section>

        <section className="mb-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="venus-serif text-lg">Recent sessions</h2>
            <span className="text-muted-foreground text-xs">from the observe hook · last 20</span>
          </div>
          {traces.length === 0 ? (
            <div className="venus-texture rounded-3xl border bg-card p-6 text-center">
              <p className="venus-serif text-lg">Nothing traced yet.</p>
              <p className="mt-1.5 text-muted-foreground text-sm">
                The first conversation after this deploy will appear here — turns, steps, tools, tokens.
              </p>
            </div>
          ) : (
            <div className="space-y-3">{traces.map((t) => <TraceRow key={t.id} t={t} />)}</div>
          )}
        </section>

        <section className="mb-10 rounded-3xl border bg-card/60 p-5 text-sm leading-relaxed">
          <h2 className="venus-serif mb-2 text-lg">How the trace is made</h2>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <b className="text-foreground">Model plane</b> — every model call goes straight to Nebius Token Factory
              (<code>agent/lib/nebius.ts</code>), no gateway in between.
            </li>
            <li>
              <b className="text-foreground">Traces</b> — <code>agent/instrumentation.ts</code> exports eve's
              per-turn OpenTelemetry spans (model calls and tool executions) to LangSmith;
              <code> agent/hooks/observe.ts</code> folds the same event stream into the KV summaries above.
            </li>
            <li>
              <b className="text-foreground">Evals</b> — <code>evals/*.eval.ts</code> drive the real agent over HTTP;
              <code> scripts/eval-replies.ts</code> scores reply classification against a labelled set and files a
              LangSmith experiment.
            </li>
            <li>
              <b className="text-foreground">Specialists</b> — each research child is a declared subagent
              (<code>agent/subagents/scout</code>) with only search and <code>record_vendor</code>: it cannot email
              anyone. It records each vendor as it verifies it, so a truncated run loses nothing, and
              <code> get_research</code> reports a specialist that recorded zero as a failure rather than an
              empty market.
            </li>
            <li>
              <b className="text-foreground">This page</b> — the diagram is the 2026 agent stack: control plane,
              harness, tool plane, state, model plane, final outcome. It lights up from the same event streams
              the browser attaches to, one per agent.
            </li>
          </ul>
        </section>

        <footer className="flex justify-center gap-4 text-muted-foreground text-xs">
          <Link className="hover:text-foreground" href="/">← back to Venus</Link>
          <Link className="hover:text-foreground" href="/my-wedding">my wedding</Link>
          <Link className="hover:text-foreground" href="/curated">the gallery</Link>
        </footer>
      </div>
    </main>
  );
}
