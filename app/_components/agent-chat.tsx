"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import {
  ActivityIcon,
  AlertCircleIcon,
  ClipboardListIcon,
  ImageIcon,
  MenuIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { isDelegationPart } from "@/agent/lib/actions";
import type { StackEvent, StackRuntime } from "./agent-stack";
import { ObservabilityRail } from "./observability-rail";
import { useAgentLanes } from "./use-agent-lanes";
import { clearSavedSession, type CuratedPreview, saveSession } from "./venus-app";

export interface SavedVenusSession {
  session: { sessionId?: string; continuationToken?: string; streamIndex: number };
  events: readonly unknown[];
  savedAt: string;
}

const COPY = {
  eyebrow: "Your private wedding planner",
  headline: "You can already picture the day. I'll build it.",
  subhead:
    "I research real venues and vendors, write to them in your voice, negotiate the details, and follow up until every answer is in your hands.",
  sliderLabel: "Your budget",
  sliderHint: "Slide to where you're comfortable — I'll make every dollar behave beautifully.",
  cta: "Begin with Venus",
  trustLine:
    "Real vendors, real emails — I write them in your voice, send them the moment you pick your plan, and gently nudge anyone who doesn't reply. Say the word and I'll stop any thread.",
  question:
    "Close your eyes for a moment. It's the evening of your wedding — where are you standing, who is around you, and what does it feel like? Tell me everything you can see. I'll take it from there.",
  checklistIntro: "For your perfect plan, tell me:",
  checklist: [
    "Season or date (+ how flexible)",
    "Location & how far you'll travel",
    "Guest count",
    "Style / vibe in a few words",
    "Live music or DJ?",
    "Photographer style · videographer?",
    "Food & bar style",
    "Must-haves & dealbreakers",
    "Anything already booked",
  ],
  working: "Venus is composing your wedding…",
} as const;

const TIERS = [
  {
    min: 5000,
    name: "Intimate",
    blurb: "A small, deeply personal celebration where every detail is chosen, not defaulted.",
  },
  {
    min: 15000,
    name: "Elevated",
    blurb:
      "The full classic wedding, composed with restraint and taste — nothing wasted, nothing missing.",
  },
  {
    min: 35000,
    name: "Grand",
    blurb:
      "A statement evening: remarkable venue, layered florals, and a room your guests will talk about for years.",
  },
  {
    min: 65000,
    name: "Ultra-Luxe",
    blurb:
      "No compromises. The rarest venues, the most sought-after artists, and a day orchestrated to the minute.",
  },
] as const;

// Fixed petal configs — deterministic so server and client render identically.
const PETALS = [
  { left: "6%", size: 22, dur: "19s", delay: "0s", sway: "5vw", spin: "220deg", o: 0.4, c: "var(--rose)" },
  { left: "18%", size: 14, dur: "23s", delay: "4s", sway: "-4vw", spin: "-180deg", o: 0.3, c: "var(--gold)" },
  { left: "33%", size: 18, dur: "17s", delay: "9s", sway: "6vw", spin: "260deg", o: 0.35, c: "var(--sage)" },
  { left: "52%", size: 12, dur: "25s", delay: "2s", sway: "-6vw", spin: "200deg", o: 0.3, c: "var(--rose)" },
  { left: "68%", size: 20, dur: "21s", delay: "12s", sway: "4vw", spin: "-240deg", o: 0.4, c: "var(--rose)" },
  { left: "81%", size: 15, dur: "18s", delay: "6s", sway: "-5vw", spin: "190deg", o: 0.3, c: "var(--gold)" },
  { left: "92%", size: 17, dur: "24s", delay: "15s", sway: "-3vw", spin: "230deg", o: 0.35, c: "var(--sage)" },
] as const;

function Petals() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {PETALS.map((p, i) => (
        <svg
          className="venus-petal"
          key={i}
          style={
            {
              left: p.left,
              width: p.size,
              height: p.size,
              "--petal-duration": p.dur,
              "--petal-delay": p.delay,
              "--petal-sway": p.sway,
              "--petal-spin": p.spin,
              "--petal-opacity": p.o,
            } as React.CSSProperties
          }
          viewBox="0 0 24 24"
        >
          <path
            d="M12 2C16 7 19 11 12 22C5 11 8 7 12 2Z"
            fill={p.c}
            opacity="0.8"
          />
        </svg>
      ))}
    </div>
  );
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function VenusLanding({
  curatedPreview,
  errorMessage,
  isStarting,
  onBegin,
}: {
  readonly curatedPreview?: CuratedPreview | null;
  readonly errorMessage?: string;
  readonly isStarting: boolean;
  readonly onBegin: (budget: number) => void;
}) {
  const [budget, setBudget] = useState(28000);
  const tier = useMemo(() => [...TIERS].reverse().find((t) => budget >= t.min) ?? TIERS[0], [budget]);
  const pct = ((budget - 5000) / 95000) * 100;

  return (
    <div className="venus-rise flex w-full max-w-xl flex-col items-center gap-7 text-center">
      <div className="flex flex-col items-center gap-3">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">{COPY.eyebrow}</p>
        <h1 className="venus-script text-7xl leading-none text-primary sm:text-8xl">Venus</h1>
        <h2 className="max-w-md venus-serif text-2xl leading-snug sm:text-[1.7rem]">{COPY.headline}</h2>
        <p className="max-w-md text-muted-foreground text-sm leading-relaxed">{COPY.subhead}</p>
      </div>

      <div className="venus-texture w-full rounded-3xl border bg-card p-6 shadow-[0_18px_50px_-24px_rgba(160,90,100,0.35)] sm:p-7">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {COPY.sliderLabel}
          </span>
          <span className="rounded-full bg-accent px-3 py-1 venus-serif text-accent-foreground text-xs tracking-wide">
            {tier.name}
          </span>
        </div>
        <p className="mt-3 venus-serif text-4xl tabular-nums tracking-tight sm:text-5xl">{usd(budget)}</p>
        <p className="mt-0.5 venus-script text-gold text-xl">the estimated cost of love</p>
        <input
          aria-label="Wedding budget"
          aria-valuetext={`${usd(budget)} — ${tier.name}`}
          className="venus-slider mt-4 h-[22px] w-full cursor-pointer appearance-none bg-transparent outline-none"
          max={100000}
          min={5000}
          onChange={(e) => setBudget(Number(e.target.value))}
          step={1000}
          style={{
            background: `linear-gradient(to right, var(--rose) 0%, var(--rose) ${pct}%, var(--muted) ${pct}%, var(--muted) 100%) no-repeat center / 100% 8px`,
            borderRadius: "9999px",
          }}
          type="range"
          value={budget}
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>$5,000</span>
          <span>$100,000</span>
        </div>
        <p aria-live="polite" className="mt-2 min-h-9 text-muted-foreground text-xs leading-relaxed">
          {tier.blurb}
        </p>
        {errorMessage ? (
          <p className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-left text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
        <button
          className="venus-bloom mt-4 h-12 w-full rounded-2xl bg-primary font-medium text-primary-foreground text-sm disabled:opacity-60"
          disabled={isStarting}
          onClick={() => onBegin(budget)}
          type="button"
        >
          {isStarting ? "Starting…" : COPY.cta}
        </button>
      </div>

      <div className="max-w-md space-y-4">
        <p className="venus-serif text-[15px] italic leading-relaxed text-foreground/80">
          “{COPY.question}”
        </p>
        <div className="text-left">
          <p className="mb-2 text-center text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {COPY.checklistIntro}
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {COPY.checklist.map((item) => (
              <span
                className="rounded-full border border-border bg-card/70 px-3 py-1 text-[11px] text-foreground/75"
                key={item}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">{COPY.trustLine}</p>
      </div>

      <a
        className="venus-bloom relative block w-full overflow-hidden rounded-3xl border shadow-[0_14px_40px_-24px_rgba(160,90,100,0.45)]"
        href="/curated"
      >
        {curatedPreview?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt="Curated by Venus"
            className="h-40 w-full object-cover sm:h-44"
            src={curatedPreview.image}
          />
        ) : (
          <div className="venus-texture flex h-40 w-full items-center justify-center bg-card sm:h-44">
            <span className="venus-script text-5xl text-primary/60">V</span>
          </div>
        )}
        <div
          className="absolute inset-0 flex flex-col justify-end p-4 text-left"
          style={{
            background: "linear-gradient(to top, rgba(40,24,26,0.82), rgba(40,24,26,0.12) 55%, transparent)",
          }}
        >
          <p className="text-[10px] uppercase tracking-[0.25em] text-white/75">
            Curated by Venus
          </p>
          <p className="venus-serif text-lg text-white leading-snug">
            {curatedPreview ? curatedPreview.title : "Weddings I've composed"}
          </p>
          <p className="text-[11px] text-white/85">
            {curatedPreview && curatedPreview.count > 1
              ? `Browse ${curatedPreview.count} real weddings — venues, photos, and full budgets →`
              : "Real venues, real photos, full budgets — see the gallery →"}
          </p>
        </div>
      </a>
    </div>
  );
}

type AgentStatus = ReturnType<typeof useEveAgent>["status"];

export function AgentChat({
  curatedPreview,
  runtime,
  saved,
}: {
  readonly curatedPreview?: CuratedPreview | null;
  readonly runtime?: StackRuntime | null;
  readonly saved?: SavedVenusSession | null;
}) {
  const agent = useEveAgent(
    saved
      ? {
          initialSession: saved.session,
          initialEvents: saved.events as never,
        }
      : undefined,
  );
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

  // The observability rail is permanent on desktop. Below lg there is no room
  // for two panes, so the same rail opens as a sheet from the header button.
  const [sheetOpen, setSheetOpen] = useState(false);

  // One lane per agent in the tree: Venus, plus a live attachment to every
  // research specialist's own session stream (see use-agent-lanes.ts).
  const { lanes, langsmithUrl, research } = useAgentLanes({
    rootEvents: agent.events as readonly StackEvent[],
    rootSessionId: agent.session?.sessionId,
    status: agent.status,
  });

  // Persist the resumable cursor + authoritative events so a refresh or a
  // closed tab never loses the wedding. Saved when a turn settles and on
  // the way out the door; the durable session server-side does the rest.
  const persistRef = useRef({ session: agent.session, events: agent.events });
  persistRef.current = { session: agent.session, events: agent.events };
  useEffect(() => {
    if (agent.status !== "ready" && agent.status !== "error") return;
    const { session, events } = persistRef.current;
    if (session?.sessionId && events.length > 0) {
      saveSession({ session, events, savedAt: new Date().toISOString() });
    }
  }, [agent.status, agent.events.length]);
  const suppressPersistRef = useRef(false);
  useEffect(() => {
    const flush = () => {
      if (suppressPersistRef.current) return; // starting fresh — don't resurrect
      const { session, events } = persistRef.current;
      if (session?.sessionId && events.length > 0) {
        saveSession({ session, events, savedAt: new Date().toISOString() });
      }
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const startFresh = () => {
    suppressPersistRef.current = true; // the unload flush must not re-save
    clearSavedSession();
    window.location.reload();
  };

  // The quiet stretch after every specialist reports back, while Venus writes
  // the three visions — fill it, don't leave the couple staring at a gap.
  const isFinalizing = useMemo(() => {
    if (!isBusy) return false;
    let delegations = 0;
    let settled = 0;
    for (const m of agent.data.messages) {
      for (const p of m.parts) {
        if (p.type !== "dynamic-tool") continue;
        if (!isDelegationPart(p)) continue;
        delegations++;
        if (
          p.state === "output-available" ||
          p.state === "output-error" ||
          p.state === "output-denied"
        ) {
          settled++;
        }
      }
    }
    return delegations >= 2 && settled === delegations;
  }, [agent.data.messages, isBusy]);

  // No broken image boxes, ever: any venue photo that fails to load vanishes.
  useEffect(() => {
    const hideBroken = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "IMG" && t.closest("[data-venus-chat]")) {
        t.style.display = "none";
      }
    };
    document.addEventListener("error", hideBroken, true);
    return () => document.removeEventListener("error", hideBroken, true);
  }, []);

  const begin = (budget: number) => {
    if (isBusy || !isEmpty) return; // no double-taps, no duplicate openings
    void agent.send({
      message: `Hi Venus! Our budget is around ${usd(budget)} — plan our wedding for us.`,
    });
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isBusy) return;

    if (message.files.length === 0) {
      await agent.send({ message: text });
      return;
    }

    const parts: UserContent = [];
    if (text.length > 0) {
      parts.push({ text, type: "text" });
    }
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }

    await agent.send({ message: parts });
  };

  const composer = (
    // Liquid glass, floating over the conversation; while Venus generates,
    // the Siri ring circles it — colors blurring and drifting hypnotically.
    <div
      className={cn("venus-glass rounded-3xl", isBusy && "venus-siri")}
      data-venus-composer=""
      // Inline because the CSS minifier strips backdrop-filter from stylesheets.
      style={{
        backdropFilter: "blur(18px) saturate(1.7)",
        WebkitBackdropFilter: "blur(18px) saturate(1.7)",
      }}
    >
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputTextarea placeholder="Tell Venus…" />
        <PromptInputSubmit onStop={agent.stop} status={agent.status} />
      </PromptInput>
    </div>
  );

  const rail = (
    <ObservabilityRail
      langsmithUrl={langsmithUrl}
      lanes={lanes}
      research={research}
      runtime={runtime}
      sessionId={agent.session?.sessionId ?? null}
      status={agent.status}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {isEmpty ? <Petals /> : null}
      {isEmpty ? null : (
        <header className="flex h-14 shrink-0 items-center justify-between px-4">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="venus-script text-3xl text-primary leading-none">Venus</span>
            <StatusDot status={agent.status} />
          </span>
          <span className="flex items-center gap-1">
            <button
              className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground sm:flex"
              onClick={startFresh}
              type="button"
            >
              <RotateCcwIcon className="size-3.5" />
              New session
            </button>
            <button
              aria-label="Live agent stack"
              aria-pressed={sheetOpen}
              className={cn(
                "flex size-10 items-center justify-center rounded-full transition-colors hover:bg-muted hover:text-foreground lg:hidden",
                sheetOpen ? "text-primary" : "text-muted-foreground",
              )}
              onClick={() => setSheetOpen((o) => !o)}
              type="button"
            >
              <ActivityIcon className="size-5" />
            </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Menu"
                className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                type="button"
              >
                <MenuIcon className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-2xl">
              <DropdownMenuItem asChild>
                <a className="flex cursor-pointer items-center gap-2.5" href="/my-wedding">
                  <ClipboardListIcon className="size-4" />
                  My Wedding
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a className="flex cursor-pointer items-center gap-2.5" href="/curated">
                  <ImageIcon className="size-4" />
                  Curated by Venus
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a className="flex cursor-pointer items-center gap-2.5" href="/observe">
                  <ActivityIcon className="size-4" />
                  Observability
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="flex cursor-pointer items-center gap-2.5" onClick={startFresh}>
                <RotateCcwIcon className="size-4" />
                Start a new wedding
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </span>
        </header>
      )}

      {!isEmpty && isBusy ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 sm:px-6">
          <div className="venus-rise flex items-center gap-3 rounded-2xl border border-accent bg-accent/25 px-4 py-2.5">
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-rose" />
            </span>
            <p className="text-xs leading-relaxed">
              <span className="font-medium">I'm working on this in the background</span>
              <span className="text-muted-foreground">
                {" "}
                — deep research can take 5–10 minutes. Keep this tab open so we don't lose our
                thread. (Early preview: I'm tuned for care over speed.)
              </span>
            </p>
          </div>
        </div>
      ) : null}

      {agent.error ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 sm:px-6">
          <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">That didn't go through</p>
              <p className="mt-0.5 text-muted-foreground">{agent.error.message}</p>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? null : (
        <Conversation className="min-h-0 flex-1" data-venus-chat="">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-6 pb-36 sm:px-6">
            {agent.data.messages.map((message, index) => (
              <AgentMessage
                canRespond={!isBusy}
                isStreaming={
                  agent.status === "streaming" && index === agent.data.messages.length - 1
                }
                key={message.id}
                message={message}
                onInputResponses={(inputResponses) => agent.send({ inputResponses })}
              />
            ))}
            {isFinalizing ? (
              <div className="venus-rise venus-texture rounded-3xl border bg-card/80 p-5 text-center">
                <p className="venus-serif text-lg">All my specialists are back 🤍</p>
                <p className="mx-auto mt-1.5 max-w-sm text-muted-foreground text-sm leading-relaxed">
                  I'm weaving everything into your three visions right now — your wedding details
                  are being finalized. Hang tight, this is the good part ✨
                </p>
                <div className="venus-progress mx-auto mt-4 max-w-xs" data-state="running">
                  <div className="venus-progress-fill" />
                </div>
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          isEmpty
            ? // justify-start + inner my-auto: centers when it fits, scrolls from the
              // top when it doesn't (justify-center would clip the wordmark off-screen).
              "relative flex max-w-xl flex-1 flex-col items-center justify-start gap-6 overflow-y-auto py-8"
            : // Floating glass bar: conversation scrolls beneath it.
              "absolute inset-x-0 bottom-0 z-10 max-w-3xl pb-4",
        )}
      >
        {isEmpty ? (
          // Onboarding gate: no prompt bar until "Begin with Venus" is tapped.
          <div className="my-auto flex w-full flex-col items-center gap-6">
            <VenusLanding
              curatedPreview={curatedPreview}
              errorMessage={agent.error?.message}
              isStarting={isBusy}
              onBegin={begin}
            />
          </div>
        ) : (
          <div className="w-full">{composer}</div>
        )}
      </div>
      </main>

      {/* Permanent on desktop: the engineering half of the product. */}
      <div className="hidden w-[26rem] shrink-0 lg:block">{rail}</div>

      {/* Below lg there is no room for two panes: the same rail as a sheet. */}
      {sheetOpen ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            aria-label="Close the agent stack"
            className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]"
            onClick={() => setSheetOpen(false)}
            type="button"
          />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[82vh] flex-col rounded-t-3xl border-t bg-background shadow-2xl">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <span className="font-medium text-sm">Under the hood</span>
              <button
                className="rounded-full px-3 py-1 text-muted-foreground text-xs hover:bg-muted"
                onClick={() => setSheetOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{rail}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusDot({ status }: { readonly status: AgentStatus }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone =
    status === "error"
      ? "bg-destructive"
      : isLive
        ? "bg-sage"
        : status === "ready"
          ? "bg-muted-foreground"
          : "bg-muted-foreground/50";

  return (
    <span className="relative flex size-1.5">
      {isLive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            tone,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-1.5 rounded-full transition-colors", tone)} />
    </span>
  );
}
