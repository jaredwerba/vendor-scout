"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";

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
  nameLabel: "Your first name",
  namePlaceholder: "So I know who I'm planning for…",
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
  onBegin,
}: {
  readonly onBegin: (budget: number, firstName: string) => void;
}) {
  const [budget, setBudget] = useState(28000);
  const [firstName, setFirstName] = useState("");
  const tier = useMemo(() => [...TIERS].reverse().find((t) => budget >= t.min) ?? TIERS[0], [budget]);
  const pct = ((budget - 5000) / 95000) * 100;
  const ready = firstName.trim().length >= 2;

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
        <label className="mt-1 block text-left">
          <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {COPY.nameLabel}
          </span>
          <input
            autoComplete="given-name"
            className="mt-1.5 h-12 w-full rounded-2xl border border-input bg-background px-4 text-base outline-none focus:border-ring"
            maxLength={40}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder={COPY.namePlaceholder}
            type="text"
            value={firstName}
          />
        </label>
        {ready ? (
          <button
            className="venus-bloom venus-rise mt-3 h-12 w-full rounded-2xl bg-primary font-medium text-primary-foreground text-sm"
            onClick={() => onBegin(budget, firstName.trim())}
            type="button"
          >
            {COPY.cta}
          </button>
        ) : (
          <p className="mt-3 flex h-12 items-center justify-center text-muted-foreground text-xs">
            set your budget & tell me your name — then we begin ✨
          </p>
        )}
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
    </div>
  );
}

type AgentStatus = ReturnType<typeof useEveAgent>["status"];

export function AgentChat() {
  const agent = useEveAgent();
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

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

  const begin = (budget: number, firstName: string) => {
    if (isBusy || !isEmpty) return; // no double-taps, no duplicate openings
    void agent.send({
      message: `Hi Venus! I'm ${firstName}. Our budget is around ${usd(budget)} — plan our wedding for us.`,
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
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder="Tell Venus…" />
      <PromptInputSubmit onStop={agent.stop} status={agent.status} />
    </PromptInput>
  );

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {isEmpty ? <Petals /> : null}
      {isEmpty ? null : (
        <header className="flex h-14 shrink-0 items-center justify-center gap-3 pl-4 pr-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="venus-script text-3xl text-primary leading-none">Venus</span>
            <StatusDot status={agent.status} />
            {isBusy ? (
              <span className="truncate text-muted-foreground text-xs italic">{COPY.working}</span>
            ) : null}
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
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6">
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
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div
        className={cn(
          "relative mx-auto w-full px-4 sm:px-6",
          isEmpty
            ? // justify-start + inner my-auto: centers when it fits, scrolls from the
              // top when it doesn't (justify-center would clip the wordmark off-screen).
              "flex max-w-xl flex-1 flex-col items-center justify-start gap-6 overflow-y-auto py-8"
            : "max-w-3xl shrink-0 pb-6",
        )}
      >
        {isEmpty ? (
          // Onboarding gate: no prompt bar until "Begin with Venus" is tapped.
          <div className="my-auto flex w-full flex-col items-center gap-6">
            <VenusLanding onBegin={begin} />
          </div>
        ) : (
          <div className="w-full">{composer}</div>
        )}
      </div>
    </main>
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
