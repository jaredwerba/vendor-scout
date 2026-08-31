import Link from "next/link";
import { listCuratedWeddings } from "@/agent/lib/curated";
import { SiteNav } from "@/app/_components/site-nav";

export const dynamic = "force-dynamic";

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default async function CuratedPage() {
  const weddings = await listCuratedWeddings();

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <SiteNav current="/curated" />
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <p className="venus-script text-5xl text-primary leading-none">Venus</p>
          <h1 className="venus-serif text-2xl">Curated by Venus</h1>
          <p className="max-w-md text-muted-foreground text-sm leading-relaxed">
            Every wedding I've composed — real venues, real numbers, three visions each. Tap one
            to see the full plan.
          </p>
          <Link
            className="venus-bloom mt-1 rounded-full bg-primary px-5 py-2 font-medium text-primary-foreground text-sm"
            href="/"
          >
            Plan yours →
          </Link>
        </header>

        {weddings.length === 0 ? (
          <div className="venus-texture mx-auto max-w-md rounded-3xl border bg-card p-8 text-center">
            <p className="venus-serif text-lg">The gallery is waiting for its first wedding.</p>
            <p className="mt-2 text-muted-foreground text-sm">
              Tell me about your day and I'll compose the first one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {weddings.map((w) => (
              <Link
                className="venus-bloom group overflow-hidden rounded-3xl border bg-card shadow-[0_14px_40px_-24px_rgba(160,90,100,0.4)]"
                href={`/curated/${w.id}`}
                key={w.id}
              >
                <div className="venus-texture relative h-44 w-full overflow-hidden bg-accent/40">
                  {w.hero_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={w.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      referrerPolicy="no-referrer"
                      src={w.hero_image_url}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="venus-script text-4xl text-primary/70">{w.first_name}</span>
                    </div>
                  )}
                </div>
                <div className="space-y-2 p-5">
                  <h2 className="venus-serif text-lg leading-snug">{w.title}</h2>
                  <p className="line-clamp-2 text-muted-foreground text-xs leading-relaxed">
                    {w.brief_summary}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] text-accent-foreground">
                      {usd(w.budget_usd)}
                    </span>
                    <span className="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground">
                      {w.location}
                    </span>
                    <span className="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground">
                      {w.guest_count} guests
                    </span>
                    <span className="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground">
                      {w.style}
                    </span>
                  </div>
                  {w.tier_totals ? (
                    <p className="pt-1 text-[11px] text-muted-foreground tabular-nums">
                      Ultra-Luxe {usd(w.tier_totals.ultra_luxe)} · Elevated{" "}
                      {usd(w.tier_totals.elevated)} · Intimate {usd(w.tier_totals.intimate)}
                    </p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
