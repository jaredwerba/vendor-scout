"use client";

import { RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { TraceSummary } from "@/agent/lib/trace";
import type { StackRuntime } from "@/app/_components/agent-stack";
import { ObservabilityRail } from "@/app/_components/observability-rail";
import { useAgentLanes } from "@/app/_components/use-agent-lanes";
import { loadSavedSession } from "@/app/_components/session-storage";

/**
 * The console side of /observe: pick any session and watch its whole agent
 * tree — live if it is running, replayed from the trace store if it is not.
 *
 * Unlike the rail in the app, this owns no agent of its own, so it attaches
 * to the root session's stream as well as every specialist's. Any session id
 * works, including one pasted from a colleague.
 */
export function ObserveConsole({
  sessions,
  runtime,
  initialSessionId,
}: {
  readonly sessions: TraceSummary[];
  readonly runtime?: StackRuntime | null;
  readonly initialSessionId?: string | null;
}) {
  const fallback = useMemo(() => {
    if (initialSessionId) return initialSessionId;
    if (sessions[0]) return sessions[0].id;
    try {
      return loadSavedSession()?.session.sessionId ?? null;
    } catch {
      return null;
    }
  }, [initialSessionId, sessions]);

  const [sessionId, setSessionId] = useState<string | null>(fallback);
  const { lanes, langsmithUrl, research, refresh } = useAgentLanes({
    rootSessionId: sessionId,
    status: "ready",
    attachAll: true,
  });

  if (!sessionId) {
    return (
      <div className="venus-texture rounded-3xl border bg-card p-6 text-center">
        <p className="venus-serif text-lg">No sessions traced yet.</p>
        <p className="mt-1.5 text-muted-foreground text-sm">
          Plan a wedding with Venus and this fills with one lane per agent — hers, and every
          research specialist she delegates to.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-muted-foreground text-xs" htmlFor="observe-session">
          Session
        </label>
        <select
          className="min-w-0 flex-1 rounded-full border bg-card px-3 py-1.5 text-xs"
          id="observe-session"
          onChange={(e) => setSessionId(e.target.value)}
          value={sessionId}
        >
          {sessions.length === 0 ? <option value={sessionId}>{sessionId}</option> : null}
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {new Date(s.startedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
              {" · "}
              {s.title ?? "session"}
              {" · "}
              {s.status}
              {s.subagents ? ` · ${s.subagents} specialists` : ""}
            </option>
          ))}
        </select>
        <button
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-muted-foreground text-xs hover:bg-muted"
          onClick={refresh}
          type="button"
        >
          <RefreshCwIcon className="size-3.5" />
          Refresh
        </button>
      </div>

      <div className="rounded-3xl border bg-card/60 p-4">
        <ObservabilityRail
          langsmithUrl={langsmithUrl}
          lanes={lanes}
          research={research}
          runtime={runtime}
          sessionId={sessionId}
          status="ready"
          variant="console"
        />
      </div>
    </div>
  );
}
