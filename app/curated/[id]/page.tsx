import Link from "next/link";
import { notFound } from "next/navigation";
import { getCuratedWedding } from "@/agent/lib/curated";
import { PlanMarkdown } from "../plan-markdown";

export const dynamic = "force-dynamic";

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default async function CuratedDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const w = await getCuratedWedding(id);
  if (!w) notFound();

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link className="venus-script text-4xl text-primary leading-none" href="/curated">
            Venus
          </Link>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Curated by Venus
          </p>
          <h1 className="venus-serif text-2xl leading-snug">{w.title}</h1>
          <p className="max-w-md text-muted-foreground text-sm leading-relaxed">{w.brief_summary}</p>
          <div className="flex flex-wrap justify-center gap-1.5 pt-1">
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] text-accent-foreground">
              {usd(w.budget_usd)}
            </span>
            <span className="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground">
              {w.location}
            </span>
            <span className="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground">
              {w.season}
            </span>
            <span className="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground">
              {w.guest_count} guests
            </span>
          </div>
        </header>

        {w.image_urls && w.image_urls.length > 0 ? (
          <div
            className="mb-6 flex gap-2 overflow-x-auto rounded-2xl"
            style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none" }}
          >
            {w.image_urls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={w.title}
                className="h-52 w-[85%] flex-none rounded-2xl object-cover sm:h-64 sm:w-[55%]"
                key={url}
                src={url}
                style={{ scrollSnapAlign: "center", scrollSnapStop: "always" }}
              />
            ))}
          </div>
        ) : null}

        <article
          className="venus-texture rounded-3xl border bg-card p-5 sm:p-8"
          data-venus-chat=""
        >
          <PlanMarkdown markdown={w.plan_markdown} />
        </article>

        {w.research_markdown ? (
          <details className="mt-6 rounded-3xl border bg-card/70 p-5 sm:p-6">
            <summary className="venus-serif cursor-pointer text-base hover:text-primary">
              Venus's full research notes — every vendor considered
            </summary>
            <div className="mt-4" data-venus-chat="">
              <PlanMarkdown markdown={w.research_markdown} />
            </div>
          </details>
        ) : null}

        <footer className="mt-8 flex flex-col items-center gap-3 text-center">
          <p className="venus-serif text-sm italic text-muted-foreground">
            Want yours in the gallery?
          </p>
          <Link
            className="venus-bloom rounded-full bg-primary px-6 py-2.5 font-medium text-primary-foreground text-sm"
            href="/"
          >
            Plan my wedding with Venus
          </Link>
          <Link className="text-muted-foreground text-xs hover:text-foreground" href="/curated">
            ← back to the gallery
          </Link>
        </footer>
      </div>
    </main>
  );
}
