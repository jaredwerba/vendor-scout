"use client";

import { useEffect } from "react";
import { clearSavedSession } from "@/app/_components/session-storage";

/**
 * Clears this browser's saved session and drops the visitor on the landing.
 * The durable session still exists server-side — this forgets the pointer to
 * it, which is what "start a new wedding" means from the couple's side.
 */
export function NewSession() {
  useEffect(() => {
    clearSavedSession();
    try {
      localStorage.removeItem("venus_stack_open");
    } catch {}
    window.location.replace("/");
  }, []);

  return (
    <main className="flex h-dvh items-center justify-center bg-background text-muted-foreground text-sm">
      Starting a fresh session…
    </main>
  );
}
