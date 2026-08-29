import Link from "next/link";
import comparison from "@/evals/data/v1-v2.json";

export const dynamic = "force-dynamic";

/**
 * V1 to V2 — the architecture comparison.
 *
 * The prose is written in ASD-STE100 (Simplified Technical English): short
 * active sentences, one meaning for each word, and consistent terms. Venus
 * herself keeps her own voice in the chat; only this page is technical.
 *
 * Complex changes use STAR — situation, task, action, result — because "what
 * changed" is not useful without "what happened when it changed".
 */

interface Change {
  id: string;
  title: string;
  complex?: boolean;
  old: string;
  new: string;
  why: string;
  result: string;
  star?: { situation: string; task: string; action: string; result: string };
}

const { v1, v2, changes } = comparison as unknown as {
  v1: Record<string, string>;
  v2: Record<string, string>;
  changes: Change[];
};

const ROWS: Array<{ key: string; label: string }> = [
  { key: "dates", label: "Dates" },
  { key: "modelPlane", label: "Model plane" },
  { key: "delegation", label: "Delegation" },
  { key: "findings", label: "Findings" },
  { key: "guards", label: "Guards" },
  { key: "observability", label: "Observability" },
  { key: "evaluation", label: "Evaluation" },
  { key: "score", label: "Research score" },
];

function Star({ star }: { readonly star: NonNullable<Change["star"]> }) {
  const parts: Array<[string, string]> = [
    ["Situation", star.situation],
    ["Task", star.task],
    ["Action", star.action],
    ["Result", star.result],
  ];
  return (
    <div className="mt-3 rounded-2xl border border-primary/25 bg-primary/5 p-4">
      <p className="mb-2 font-medium text-[11px] text-primary uppercase tracking-[0.18em]">
        STAR
      </p>
      <dl className="space-y-2">
        {parts.map(([k, v]) => (
          <div className="grid gap-1 sm:grid-cols-[6rem_1fr]" key={k}>
            <dt className="font-medium text-muted-foreground text-xs">{k}</dt>
            <dd className="text-sm leading-relaxed">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function ComparePage() {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link className="venus-script text-5xl text-primary leading-none" href="/">
            Venus
          </Link>
          <h1 className="venus-serif text-2xl">V1 to V2</h1>
          <p className="max-w-xl text-muted-foreground text-sm leading-relaxed">
            This page compares the first architecture with the second one. It gives the reason for
            each change and the result of each change. The text uses Simplified Technical English
            (ASD-STE100).
          </p>
        </header>

        {/* The two states, side by side. */}
        <section className="mb-10">
          <h2 className="venus-serif mb-3 text-lg">The two architectures</h2>
          <div className="overflow-x-auto rounded-2xl border bg-card/70">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2.5 font-medium text-xs" />
                  <th className="px-4 py-2.5 font-medium">
                    V1 <span className="font-normal text-muted-foreground text-xs">old</span>
                  </th>
                  <th className="px-4 py-2.5 font-medium">
                    V2 <span className="font-normal text-muted-foreground text-xs">new</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr className="border-b align-top last:border-b-0" key={row.key}>
                    <th className="w-32 px-4 py-3 text-left font-medium text-muted-foreground text-xs">
                      {row.label}
                    </th>
                    <td className="px-4 py-3 text-muted-foreground leading-relaxed">
                      {v1[row.key]}
                    </td>
                    <td className="px-4 py-3 leading-relaxed">{v2[row.key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-muted-foreground text-xs">
            V1 is commit <code>{v1.commit}</code>. V2 is commit <code>{v2.commit}</code>.
          </p>
        </section>

        {/* Each change: old, new, why, result. */}
        <section className="mb-10">
          <h2 className="venus-serif mb-1 text-lg">The changes</h2>
          <p className="mb-4 text-muted-foreground text-sm leading-relaxed">
            Each item shows the old approach and the new approach. It gives the reason for the
            change and the measured result. Four items use STAR, because they are complex.
          </p>
          <div className="space-y-4">
            {changes.map((c, i) => (
              <article className="rounded-2xl border bg-card/70 p-5" key={c.id}>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-muted-foreground text-xs">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-medium">{c.title}</h3>
                </div>

                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                    <dt className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                      Old approach · V1
                    </dt>
                    <dd className="text-sm leading-relaxed">{c.old}</dd>
                  </div>
                  <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
                    <dt className="mb-1 font-medium text-[11px] text-primary uppercase tracking-wide">
                      New approach · V2
                    </dt>
                    <dd className="text-sm leading-relaxed">{c.new}</dd>
                  </div>
                </dl>

                <dl className="mt-3 space-y-2">
                  <div className="grid gap-1 sm:grid-cols-[6rem_1fr]">
                    <dt className="font-medium text-muted-foreground text-xs">Reason</dt>
                    <dd className="text-sm leading-relaxed">{c.why}</dd>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-[6rem_1fr]">
                    <dt className="font-medium text-muted-foreground text-xs">Result</dt>
                    <dd className="text-sm leading-relaxed">{c.result}</dd>
                  </div>
                </dl>

                {c.star ? <Star star={c.star} /> : null}
              </article>
            ))}
          </div>
        </section>

        <section className="mb-10 rounded-2xl border bg-card/60 p-5">
          <h2 className="venus-serif mb-2 text-lg">What the faults have in common</h2>
          <p className="text-sm leading-relaxed">
            No fault in this list stopped the system. There was no crash and no failed build. The
            costs showed zero. An event in the documentation was never sent. A page was correct in
            development and absent in production. Ten agents of ten failed inside a build that
            passed.
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            A fault that looks like success is the most expensive kind. Each change above adds a
            check that makes one of these faults visible.
          </p>
        </section>

        <footer className="flex flex-wrap justify-center gap-4 text-muted-foreground text-xs">
          <Link className="hover:text-foreground" href="/">
            ← back to Venus
          </Link>
          <Link className="hover:text-foreground" href="/observe">
            observability
          </Link>
          <Link className="hover:text-foreground" href="/curated">
            the gallery
          </Link>
        </footer>
      </div>
    </main>
  );
}
