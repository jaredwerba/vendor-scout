"use client";

import { useEffect, useState } from "react";
import { AgentChat, type SavedVenusSession } from "./agent-chat";
import type { StackRuntime } from "./agent-stack";

const STORAGE_KEY = "venus_session_v1";

export function loadSavedSession(): SavedVenusSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedVenusSession;
    if (!parsed?.session?.sessionId || !Array.isArray(parsed.events)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(data: SavedVenusSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota or private-mode failure: better to lose resume than to crash.
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
}

export function clearSavedSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

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
