"use client";

import { useEffect, useState } from "react";
import { AgentChat } from "./agent-chat";
import { loadSavedSession, type SavedVenusSession } from "./session-storage";
import type { StackRuntime } from "./agent-stack";

export interface CuratedPreview {
  image: string | null;
  title: string;
  count: number;
}

/**
 * Mount gate for session resume: localStorage only exists client-side, and
 * useEveAgent binds its session at store creation — so we decide (fresh vs
 * restored) exactly once, after mount, then render the chat.
 */
export function VenusApp({
  curatedPreview,
  runtime,
}: {
  readonly curatedPreview?: CuratedPreview | null;
  readonly runtime?: StackRuntime | null;
}) {
  const [state, setState] = useState<
    { ready: false } | { ready: true; saved: SavedVenusSession | null }
  >({ ready: false });

  useEffect(() => {
    setState({ ready: true, saved: loadSavedSession() });
  }, []);

  if (!state.ready) {
    return <main className="h-dvh bg-background" />;
  }
  return (
    <AgentChat
      curatedPreview={curatedPreview}
      key={state.saved?.session.sessionId ?? "fresh"}
      runtime={runtime}
      saved={state.saved}
    />
  );
}
