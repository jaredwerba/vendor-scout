"use client";

import { useEffect } from "react";
import { MessageResponse } from "@/components/ai-elements/message";

/** Renders a saved plan with the exact same markdown engine as the chat —
 *  carousels, luxury tables, and image styling all apply via [data-venus-chat]. */
export function PlanMarkdown({ markdown }: { readonly markdown: string }) {
  // Same no-broken-images rule as the chat.
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

  return <MessageResponse isAnimating={false}>{markdown}</MessageResponse>;
}
