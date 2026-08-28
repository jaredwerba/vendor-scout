"use client";

import { useEffect, useState } from "react";
import { AgentStackReplay, type StackEvent, type StackRuntime } from "@/app/_components/agent-stack";
import { loadSavedSession } from "@/app/_components/venus-app";

/**
 * Replays this browser's last Venus session over the agent-stack diagram:
 * the same authoritative eve events the chat persisted to localStorage,
 * scrubbed or played back step by step.
 */
export function ObserveClient({ runtime }: { readonly runtime?: StackRuntime | null }) {
  const [events, setEvents] = useState<readonly StackEvent[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    const saved = loadSavedSession();
    setEvents((saved?.events as readonly StackEvent[] | undefined) ?? []);
    setSessionId(saved?.session.sessionId ?? null);
  }, []);
  if (events === null) return <div className="h-40 rounded-3xl border bg-card/40" />;
  if (events.length === 0) {
    return (
      <div className="venus-texture rounded-3xl border bg-card p-6 text-center">
        <p className="venus-serif text-lg">No session in this browser yet.</p>
        <p className="mt-1.5 text-muted-foreground text-sm">
          Plan with Venus, then come back — every step of that conversation replays here. In the
          chat, the pulse icon opens the same diagram live.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        Session <code className="rounded bg-muted px-1.5 py-0.5">{sessionId ?? "?"}</code> · {events.length} events
        saved in this browser
      </p>
      <AgentStackReplay events={events} runtime={runtime} />
    </div>
  );
}
