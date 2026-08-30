/**
 * The browser's copy of a wedding-planning session.
 *
 * A leaf: no React, no chat, no eve. It exists because `/new` and `/observe`
 * each wanted one localStorage call and had to import the 696-line chat —
 * and through it the whole markdown stack — to get it. `venus-app.tsx` and
 * `agent-chat.tsx` also imported values from each other, so the resume policy
 * and the module graph were tangled together.
 *
 * Everything a caller must know is here: the key, the shape, the expiry, and
 * what happens when the quota is full.
 */

export interface SavedVenusSession {
  session: { sessionId?: string; continuationToken?: string; streamIndex: number };
  events: readonly unknown[];
  savedAt: string;
}

const STORAGE_KEY = "venus_session_v1";

/**
 * How long a saved session keeps auto-resuming. Venus is a public demo: the
 * next visitor on a shared machine should meet her fresh, not walk into
 * someone else's half-planned wedding. The durable session server-side is
 * untouched — /my-wedding and the archive still hold everything.
 */
const RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadSavedSession(): SavedVenusSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedVenusSession;
    if (!parsed?.session?.sessionId || !Array.isArray(parsed.events)) return null;
    const savedAt = Date.parse(parsed.savedAt ?? "");
    if (Number.isFinite(savedAt) && Date.now() - savedAt > RESUME_MAX_AGE_MS) {
      clearSavedSession();
      return null;
    }
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
