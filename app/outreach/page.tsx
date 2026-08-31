import Link from "next/link";
import { listRecords, type OutreachRecord } from "@/agent/lib/roster";
import { OutreachList } from "./outreach-list";
import { SiteNav } from "@/app/_components/site-nav";

export const dynamic = "force-dynamic";

/**
 * Every email Venus sent, and who received it.
 *
 * Outreach is the only real-world action this agent takes: it writes to
 * strangers, in the couple's name, from the couple's reply address. A couple
 * should never have to take that on trust, and an engineer should be able to
 * audit exactly what left the building. The roster already held all of it —
 * recipient, subject, full body, every nudge, and the reply — with no way to
 * look at it.
 */
export default async function OutreachPage() {
  let records: OutreachRecord[] = [];
  let error: string | null = null;
  try {
    records = await listRecords();
  } catch (e) {
    error = (e as Error)?.message ?? "could not read the roster";
  }

  records.sort((a, b) => (b.sent_at ?? b.last_activity_at).localeCompare(a.sent_at ?? a.last_activity_at));

  const sent = records.filter((r) => r.sent_at).length;
  const replied = records.filter((r) => r.thread.some((t) => t.who === "vendor")).length;
  const nudges = records.reduce((n, r) => n + (r.nudge_count ?? 0), 0);
  const booked = records.filter((r) => r.booked).length;

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <SiteNav current="/outreach" />
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <p className="venus-script text-5xl text-primary leading-none">Venus</p>
          <h1 className="venus-serif text-2xl">Every email I sent</h1>
          <p className="max-w-lg text-muted-foreground text-sm leading-relaxed">
            These went out in your name, to real people. Open any one to read exactly what was
            sent, every nudge, and anything that came back.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-1.5 text-[11px]">
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-secondary-foreground">
              {sent} sent
            </span>
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-accent-foreground">
              {replied} replied
            </span>
            <span className="rounded-full border px-2.5 py-0.5 text-muted-foreground">
              {nudges} follow-ups
            </span>
            {booked > 0 ? (
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-primary-foreground">
                {booked} booked
              </span>
            ) : null}
          </div>
        </header>

        {error ? (
          <p className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive text-sm">
            {error}
          </p>
        ) : records.length === 0 ? (
          <div className="venus-texture rounded-3xl border bg-card p-6 text-center">
            <p className="venus-serif text-lg">Nothing has gone out yet.</p>
            <p className="mt-1.5 text-muted-foreground text-sm">
              Venus only writes to vendors after you pick a plan. When she does, every message
              appears here.
            </p>
          </div>
        ) : (
          <OutreachList records={records} />
        )}

        <footer className="mt-10 flex flex-wrap justify-center gap-4 text-muted-foreground text-xs">
          <Link className="hover:text-foreground" href="/">
            ← back to Venus
          </Link>
          <Link className="hover:text-foreground" href="/my-wedding">
            my wedding
          </Link>
          <Link className="hover:text-foreground" href="/observe">
            observability
          </Link>
        </footer>
      </div>
    </main>
  );
}
