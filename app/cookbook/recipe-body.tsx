"use client";

import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

/**
 * A recipe's markdown body.
 *
 * Streamdown with the code plugin only. The chat's MessageResponse also loads
 * math and mermaid; a cookbook page needs neither, and a doc page should not
 * pay for a diagram renderer it never calls.
 */
const plugins = { code };

export function RecipeBody({ markdown }: { readonly markdown: string }) {
  return (
    <Streamdown
      className="venus-prose [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      plugins={plugins}
    >
      {markdown}
    </Streamdown>
  );
}
