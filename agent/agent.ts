import { defineAgent } from "eve";

export default defineAgent({
  // Routed through the Vercel AI Gateway. Sonnet-5 is a good default for
  // reading vendor sites and building the comparison. (Cost tiering — a cheaper
  // model for sourcing, a stronger one for the final ranking — is a Milestone-2
  // optimization.)
  model: "anthropic/claude-sonnet-5",
  reasoning: "medium",
  // Safety net so a runaway session can't rack up a surprise bill during demos.
  limits: {
    maxInputTokensPerSession: 3_000_000,
    maxOutputTokensPerSession: 100_000,
  },
});
