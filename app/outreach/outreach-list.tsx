"use client";

import { ChevronDownIcon, MailIcon } from "lucide-react";
import { useState } from "react";
import type { OutreachRecord } from "@/agent/lib/roster";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  sent: "bg-secondary text-secondary-foreground",
  nudged_1: "bg-accent text-accent-foreground",
  nudged_2: "bg-accent text-accent-foreground",
  replied: "bg-primary text-primary-foreground",
  declined: "border text-muted-foreground",
  unsubscribed: "border text-muted-foreground",
  bounced: "bg-destructive/10 text-destructive",
  complained: "bg-destructive/10 text-destructive",
};

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function OutreachList({ records }: { readonly records: OutreachRecord[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-2.5">
      {records.map((r) => {
        const isOpen = open === r.id;
        const vendorReplied = r.thread.some((t) => t.who === "vendor");
        return (
          <article className="overflow-hidden rounded-2xl border bg-card/70" key={r.id}>
            <button
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              onClick={() => setOpen(isOpen ? null : r.id)}
              type="button"
            >
              <MailIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-sm">{r.vendor_name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {r.vendor_email} · {when(r.sent_at)}
                  {r.nudge_count > 0 ? ` · ${r.nudge_count} follow-up${r.nudge_count > 1 ? "s" : ""}` : ""}
                </span>
              </span>
              {r.booked ? (
                <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                  booked
                </span>
              ) : null}
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                  TONE[r.status] ?? "border text-muted-foreground",
                )}
              >
                {vendorReplied ? "replied" : r.status.replace(/_/g, " ")}
              </span>
              <ChevronDownIcon
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
              />
            </button>

            {isOpen ? (
              <div className="border-t bg-muted/20 px-4 py-3">
                <dl className="mb-3 grid gap-1 text-[11px] sm:grid-cols-2">
                  <div>
                    <dt className="inline text-muted-foreground">Subject: </dt>
                    <dd className="inline">{r.subject}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">Replies go to: </dt>
                    <dd className="inline">{r.reply_address ?? r.couple_email ?? "—"}</dd>
                  </div>
                </dl>

                <ol className="space-y-2.5">
                  {r.thread.map((t, i) => (
                    <li
                      className={cn(
                        "rounded-xl border px-3 py-2.5",
                        t.who === "agent" ? "border-primary/20 bg-primary/5" : "border-sage/40 bg-secondary/40",
                      )}
                      key={`${t.when}-${i}`}
                    >
                      <p className="mb-1 flex items-baseline justify-between gap-2 text-[10px] uppercase tracking-wide">
                        <span className={t.who === "agent" ? "text-primary" : "text-secondary-foreground"}>
                          {t.who === "agent" ? "Venus wrote" : `${r.vendor_name} replied`}
                        </span>
                        <span className="text-muted-foreground">{when(t.when)}</span>
                      </p>
                      {t.subject ? <p className="mb-1 font-medium text-xs">{t.subject}</p> : null}
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{t.text}</p>
                    </li>
                  ))}
                </ol>

                {r.reply_intel ? (
                  <div className="mt-3 rounded-xl border border-border/70 bg-card px-3 py-2.5">
                    <p className="mb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                      What Venus understood from the reply
                    </p>
                    <p className="text-[13px] leading-relaxed">{r.reply_intel.summary}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      read as <b>{r.reply_intel.intent}</b>
                      {r.reply_intel.availability ? ` · ${r.reply_intel.availability}` : ""}
                      {r.reply_intel.price_info ? ` · ${r.reply_intel.price_info}` : ""}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
