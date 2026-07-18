import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listRecords, type OutreachRecord } from "@/agent/lib/roster";
import {
  daysUntil,
  getTimelineMeta,
  listMilestones,
  type Milestone,
  type TimelineMeta,
} from "@/agent/lib/timeline";

export const dynamic = "force-dynamic";

/**
 * My Wedding — the decision dashboard. Everything Venus knows about where
 * the wedding stands: what's booked, who's replied and needs a decision,
 * who's still being chased, and what fell through.
 */

function Chip({ tone, children }: { readonly tone: string; readonly children: React.ReactNode }) {
  const tones: Record<string, string> = {
    booked: "bg-secondary text-secondary-foreground",
    action: "bg-accent text-accent-foreground",
    waiting: "border text-muted-foreground",
    closed: "border text-muted-foreground opacity-70",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${tones[tone] ?? tones.waiting}`}>
      {children}
    </span>
  );
}

function VendorRow({ r }: { readonly r: OutreachRecord }) {
  const intel = r.reply_intel;
  return (
    <div className="rounded-2xl border bg-card/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-sm">{r.vendor_name}</p>
        {r.status === "booked" ? (
          <Chip tone="booked">Booked ✓{r.booked?.price ? ` · ${r.booked.price}` : ""}</Chip>
        ) : r.status === "replied" ? (
          <Chip tone="action">
            {intel?.intent === "priced"
              ? "Sent pricing — your move"
              : intel?.intent === "available"
                ? "Available — your move"
                : intel?.intent === "needs_info"
                  ? "Asked you questions"
                  : "Replied — your move"}
          </Chip>
        ) : r.status === "sent" || r.status === "nudged_1" || r.status === "nudged_2" ? (
          <Chip tone="waiting">
            Waiting{r.next_followup_at ? ` · nudge ${r.next_followup_at.slice(5, 10)}` : ""}
          </Chip>
        ) : (
          <Chip tone="closed">{r.status === "declined" ? "Passed" : "Closed"}</Chip>
        )}
      </div>
      {intel?.summary ? (
        <p className="mt-2 text-muted-foreground text-xs leading-relaxed">{intel.summary}</p>
      ) : null}
      {intel?.price_info ? (
        <p className="mt-1 text-xs">
          <span className="text-muted-foreground">Quoted:</span> {intel.price_info}
        </p>
      ) : null}
      {intel?.questions?.length ? (
        <p className="mt-1 text-muted-foreground text-xs">
          They asked: {intel.questions.join(" · ")}
        </p>
      ) : null}
      {r.booked?.note ? (
        <p className="mt-1 text-muted-foreground text-xs italic">{r.booked.note}</p>
      ) : null}
    </div>
  );
}

export default async function MyWeddingPage() {
  const jar = await cookies();
  if (!jar.get("vs_code")?.value) redirect("/unlock");

  let records: OutreachRecord[] = [];
  let meta: TimelineMeta | null = null;
  let milestones: Milestone[] = [];
  try {
    records = await listRecords();
    meta = await getTimelineMeta();
    milestones = meta ? await listMilestones() : [];
  } catch {
    records = [];
  }
  const upcoming = milestones.filter((m) => m.status === "upcoming");
  const doneCount = milestones.filter((m) => m.status === "done").length;

  const booked = records.filter((r) => r.status === "booked");
  const needsDecision = records.filter((r) => r.status === "replied");
  const waiting = records.filter(
    (r) => r.status === "sent" || r.status === "nudged_1" || r.status === "nudged_2",
  );
  const closed = records.filter(
    (r) => r.status === "declined" || r.status === "closed" || r.status === "drafted",
  );

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link className="venus-script text-5xl text-primary leading-none" href="/">
            Venus
          </Link>
          <h1 className="venus-serif text-2xl">My Wedding</h1>
          <p className="max-w-md text-muted-foreground text-sm leading-relaxed">
            Where everything stands — updated the moment vendors reply and decisions land.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-1.5">
            {meta ? (
              <Chip tone="action">💍 {daysUntil(meta.wedding_date)} days to go</Chip>
            ) : null}
            <Chip tone="booked">{booked.length} booked</Chip>
            <Chip tone="action">{needsDecision.length} need your call</Chip>
            <Chip tone="waiting">{waiting.length} waiting on vendors</Chip>
          </div>
        </header>

        {meta && upcoming.length > 0 ? (
          <section className="mb-8">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="venus-serif text-lg">The Countdown</h2>
              <span className="text-muted-foreground text-xs">
                {doneCount}/{milestones.length} done
              </span>
            </div>
            <div className="space-y-2">
              {upcoming.slice(0, 5).map((m) => {
                const d = daysUntil(m.due_date);
                return (
                  <div
                    className="flex items-center justify-between gap-3 rounded-2xl border bg-card/70 px-4 py-3"
                    key={m.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{m.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-muted-foreground text-xs">
                        {m.detail}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${
                        d <= 14
                          ? "bg-accent text-accent-foreground"
                          : "border text-muted-foreground"
                      }`}
                    >
                      {d < 0 ? "overdue" : d === 0 ? "today" : `${d}d`}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-muted-foreground text-xs">
              Done something? Tell Venus — "we sent the save-the-dates!" — and it's crossed off.
              I'll email you as each one approaches.
            </p>
          </section>
        ) : null}

        {records.length === 0 ? (
          <div className="venus-texture mx-auto max-w-md rounded-3xl border bg-card p-8 text-center">
            <p className="venus-serif text-lg">Nothing in motion yet.</p>
            <p className="mt-2 text-muted-foreground text-sm">
              Tell me about your day and I'll start reaching out — everything lands here.
            </p>
            <Link
              className="venus-bloom mt-4 inline-block rounded-full bg-primary px-5 py-2 font-medium text-primary-foreground text-sm"
              href="/"
            >
              Plan with Venus →
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {booked.length > 0 ? (
              <section>
                <h2 className="venus-serif mb-3 text-lg">Booked & secured 🤍</h2>
                <div className="space-y-3">
                  {booked.map((r) => (
                    <VendorRow key={r.id} r={r} />
                  ))}
                </div>
              </section>
            ) : null}
            {needsDecision.length > 0 ? (
              <section>
                <h2 className="venus-serif mb-3 text-lg">Your move</h2>
                <div className="space-y-3">
                  {needsDecision.map((r) => (
                    <VendorRow key={r.id} r={r} />
                  ))}
                </div>
                <p className="mt-2 text-muted-foreground text-xs">
                  Decided? Just tell Venus — "we're booking [vendor]!" — and it locks in here.
                </p>
              </section>
            ) : null}
            {waiting.length > 0 ? (
              <section>
                <h2 className="venus-serif mb-3 text-lg">Venus is on it</h2>
                <div className="space-y-3">
                  {waiting.map((r) => (
                    <VendorRow key={r.id} r={r} />
                  ))}
                </div>
              </section>
            ) : null}
            {closed.length > 0 ? (
              <section>
                <h2 className="venus-serif mb-3 text-lg text-muted-foreground">
                  Closed threads
                </h2>
                <div className="space-y-3 opacity-80">
                  {closed.map((r) => (
                    <VendorRow key={r.id} r={r} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}

        <footer className="mt-10 flex justify-center gap-4 text-muted-foreground text-xs">
          <Link className="hover:text-foreground" href="/">
            ← back to Venus
          </Link>
          <Link className="hover:text-foreground" href="/curated">
            the gallery
          </Link>
        </footer>
      </div>
    </main>
  );
}
