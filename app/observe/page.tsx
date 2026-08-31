import Link from "next/link";
import generationsData from "@/evals/data/generations.json";
import { modelIdFor, modelRouting } from "@/agent/lib/models";
import { fleetStats } from "@/agent/lib/report";
import { formatUsd } from "@/agent/lib/pricing";
import { type EvalSummary, listEvalSummaries, listTraces, type TraceSummary, traceConfigured } from "@/agent/lib/trace";
import { ObserveConsole } from "./observe-client";
import { SiteNav } from "@/app/_components/site-nav";

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
        {t.refusedActions ? ` · ${t.refusedActions} refused by guards` : ""}
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
        {e.incomplete ? (
          <Chip tone="muted">not scored · {e.passed}/{e.n}</Chip>
        ) : (
          <Chip tone={pct >= 80 ? "good" : "warn"}>{pct}% · {e.passed}/{e.n}</Chip>
        )}
      </div>
      <p className="mt-1 text-muted-foreground text-xs">
        ran {when(e.ranAt)}{e.model ? ` · ${e.model}` : ""}
        {e.langsmith?.experiment ? ` · LangSmith experiment ${e.langsmith.experiment}` : ""}
        {e.note ? ` · ${e.note}` : ""}
      </p>
      {e.incomplete ? <p className="mt-1 text-destructive text-xs">{e.incomplete}</p> : null}
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
  const routing = modelRouting();
  const runtime = {
    model: modelIdFor("planner"),
    provider: "Nebius Token Factory",
    tracing: Boolean(process.env.LANGSMITH_API_KEY),
    project: process.env.LANGSMITH_PROJECT ?? "venus",
    roles: routing.map(({ role, model, rationale }) => ({ role, model, rationale })),
  };
  const kv = traceConfigured();
  const [traces, evals, stats] = await Promise.all([
    kv ? listTraces(25).catch(() => [] as TraceSummary[]) : Promise.resolve([] as TraceSummary[]),
    kv ? listEvalSummaries().catch(() => [] as EvalSummary[]) : Promise.resolve([] as EvalSummary[]),
    kv ? fleetStats(100).catch(() => null) : Promise.resolve(null),
  ]);

  // Five configurations of the same agent against the same brief. Each row
  // names the session it was measured on; every one is open in the picker
  // below. Imported rather than read from disk — readFileSync silently finds
  // nothing inside a bundled serverless function, and the section just
  // vanished in production while rendering fine locally.
  const generations = generationsData as Array<{
    gen: number;
    name: string;
    config: string;
    scoutScore: string | null;
    sessionId: string | null;
    solved: string;
    exposed: string;
  }>;

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <SiteNav current="/observe" />
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <p className="venus-script text-5xl text-primary leading-none">Venus</p>
          <h1 className="venus-serif text-2xl">Under the hood</h1>
          <p className="max-w-md text-muted-foreground text-sm leading-relaxed">
            Every plan is an agent loop — plan, act, observe, decide — running on a model, tools,
            and memory, under a control plane that traces and evaluates it. Venus fans out one
            research specialist per category; each gets its own session, its own tool budget and
            its own lane below.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-1.5">
            <Chip tone="good">model plane · {runtime.provider}</Chip>
            <Chip tone="muted">{routing.length} models, one per job</Chip>
            <Chip tone={runtime.tracing ? "good" : "warn"}>
              {runtime.tracing ? `LangSmith tracing on · ${runtime.project}` : "LangSmith tracing off (no LANGSMITH_API_KEY)"}
            </Chip>
            <Chip tone={kv ? "good" : "warn"}>{kv ? "trace store: Upstash KV" : "trace store: not configured"}</Chip>
          </div>
        </header>

        {stats && stats.toolCalls > 0 ? (
          <section className="mb-10">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="venus-serif text-lg">What {stats.sessions} traced runs say</h2>
              <span className="text-muted-foreground text-xs">
                <code>npm run report</code>
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border bg-card/70 p-4">
                <p className="font-medium text-sm">Step reliability compounds</p>
                <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                  {stats.toolCalls.toLocaleString("en-US")} tool calls across every agent,{" "}
                  {stats.failedActions} failed —{" "}
                  <b className="text-foreground">
                    {(stats.actionSuccess * 100).toFixed(1)}% per action
                  </b>
                  . What that survives if every step must land:
                </p>
                <dl className="mt-3 space-y-1.5">
                  {stats.compounding.map((c) => (
                    <div className="flex items-center gap-2 text-xs" key={c.steps}>
                      <dt className="w-14 shrink-0 text-muted-foreground tabular-nums">
                        {c.steps} steps
                      </dt>
                      <dd className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(1, c.probability * 100)}%` }}
                          />
                        </span>
                        <span className="w-12 shrink-0 text-right tabular-nums">
                          {(c.probability * 100).toFixed(1)}%
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
                  A single research specialist runs 20–40 steps. This is the whole argument for
                  recording each vendor as it is found rather than returning them at the end —
                  and for surfacing a truncation instead of retrying it blindly.
                  {stats.truncations > 0
                    ? ` ${stats.truncations} truncations are visible in these traces rather than silent.`
                    : ""}
                </p>
              </div>

              <div className="rounded-2xl border bg-card/70 p-4">
                <p className="font-medium text-sm">Cost has long tails</p>
                {stats.cost ? (
                  <>
                    <table className="mt-2 w-full text-left text-xs tabular-nums">
                      <tbody>
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">median run</td>
                          <td className="py-1.5 text-right font-medium">
                            {formatUsd(stats.cost.median)}
                          </td>
                        </tr>
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">p90</td>
                          <td className="py-1.5 text-right font-medium">
                            {formatUsd(stats.cost.p90)}
                          </td>
                        </tr>
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">worst</td>
                          <td className="py-1.5 text-right font-medium">
                            {formatUsd(stats.cost.max)}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-1.5 text-muted-foreground">tail ratio</td>
                          <td className="py-1.5 text-right font-medium">
                            {stats.cost.ratio.toFixed(1)}× median
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
                      The tail is not an expensive model. It is an agent that would not stop —
                      the worst run here kept fanning out after its client had disconnected.
                      That is what the per-session search budgets bound, and why cost is
                      reported per agent rather than per plan.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-muted-foreground text-xs">No costed runs yet.</p>
                )}
                <p className="mt-3 border-t pt-3 text-muted-foreground text-xs">
                  {stats.agentSessions} agent sessions ·{" "}
                  {stats.steps.toLocaleString("en-US")} model steps ·{" "}
                  {formatUsd(stats.totalCostUsd)} of real inference
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {generations.length > 0 ? (
          <section className="mb-10">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="venus-serif text-lg">Five generations of the same agent</h2>
              <span className="text-muted-foreground text-xs">same brief every time</span>
            </div>
            <div className="space-y-3">
              {generations.map((g) => (
                <div className="rounded-2xl border bg-card/70 p-4" key={g.gen}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-sm">
                      <span className="text-muted-foreground">Gen {g.gen}</span> · {g.name}
                    </p>
                    {g.scoutScore ? (
                      <Chip tone={g.scoutScore.includes("45%") ? "warn" : "good"}>
                        {g.scoutScore}
                      </Chip>
                    ) : (
                      <Chip tone="muted">not measured</Chip>
                    )}
                  </div>
                  <p className="mt-1.5 text-muted-foreground text-xs leading-relaxed">{g.config}</p>
                  <dl className="mt-2.5 grid gap-2 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="font-medium">Solved</dt>
                      <dd className="mt-0.5 text-muted-foreground leading-relaxed">{g.solved}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">Exposed</dt>
                      <dd className="mt-0.5 text-muted-foreground leading-relaxed">{g.exposed}</dd>
                    </div>
                  </dl>
                  {g.sessionId ? (
                    <Link
                      className="mt-2 inline-block text-primary text-xs hover:underline"
                      href={`/observe?session=${g.sessionId}`}
                    >
                      open the traced session →
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mb-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="venus-serif text-lg">Model routing</h2>
            <span className="text-muted-foreground text-xs">
              <code>npm run models:compare</code>
            </span>
          </div>
          <div className="overflow-x-auto rounded-2xl border bg-card/70 p-4">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-1 pr-3 font-medium">job</th>
                  <th className="pb-1 pr-3 font-medium">model</th>
                  <th className="pb-1 font-medium">why</th>
                </tr>
              </thead>
              <tbody>
                {routing.map((r) => (
                  <tr className="border-t align-top" key={r.role}>
                    <td className="py-1.5 pr-3 font-medium">{r.role}</td>
                    <td className="py-1.5 pr-3">
                      <code>{r.model}</code>
                      {r.overridden ? <span className="ml-1 text-muted-foreground">(env)</span> : null}
                    </td>
                    <td className="py-1.5 text-muted-foreground leading-relaxed">{r.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

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
