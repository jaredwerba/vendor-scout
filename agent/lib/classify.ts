import { generateObject } from "ai";
import { z } from "zod";

/**
 * Reply intelligence: understand what a vendor actually said, instead of
 * keyword-guessing. One cheap model call per reply; falls back to the old
 * keyword heuristic if the model is unreachable — a reply must never be lost
 * over a classification failure.
 */

export const replyIntelSchema = z.object({
  intent: z
    .enum(["available", "unavailable", "priced", "needs_info", "declined", "unsubscribe", "other"])
    .describe(
      "available: can do the date/open to it. unavailable: booked/can't do the date. priced: " +
        "sent pricing (may also be available). needs_info: asked questions before quoting. " +
        "declined: not interested in the business. unsubscribe: asked to stop being contacted.",
    ),
  availability: z
    .string()
    .nullable()
    .describe("What they said about the date/availability, verbatim-ish. Null if unaddressed."),
  price_info: z
    .string()
    .nullable()
    .describe("Any pricing/package numbers they gave. Null if none."),
  questions: z.array(z.string()).describe("Questions the vendor asked back, if any."),
  summary: z.string().describe("1-2 warm, factual sentences a planner would relay to the couple."),
  sentiment: z.enum(["warm", "neutral", "cold"]),
});

export type ReplyIntel = z.infer<typeof replyIntelSchema>;

const DECLINE_HINTS =
  /not available|unavailable|already booked|fully booked|not taking|unable to|can't accommodate|cannot accommodate|no longer|unsubscribe|remove me|stop contacting|not interested/i;

function heuristicIntel(text: string): ReplyIntel {
  const declined = DECLINE_HINTS.test(text);
  return {
    intent: declined ? "declined" : "other",
    availability: null,
    price_info: null,
    questions: [],
    summary: declined
      ? "They don't look available — the reply reads like a pass (keyword match; model was unreachable)."
      : "A reply arrived — read it in full below (automatic understanding was unavailable).",
    sentiment: "neutral",
  };
}

export async function classifyReply(args: {
  vendorName: string;
  replyText: string;
  originalSubject?: string;
}): Promise<{ intel: ReplyIntel; via: "model" | "heuristic" }> {
  const text = args.replyText.slice(0, 6000);
  try {
    const { object } = await generateObject({
      model: "anthropic/claude-sonnet-5",
      schema: replyIntelSchema,
      prompt: [
        `A wedding vendor ("${args.vendorName}") replied to a couple's inquiry` +
          (args.originalSubject ? ` (subject: "${args.originalSubject}")` : "") +
          ". Classify the reply carefully.",
        "Cautions: conditional business language ('we're not taking a deposit until you confirm " +
          "the date') is NOT a decline. Quoted text from the couple's own email below 'On ... " +
          "wrote:' lines is not the vendor speaking — ignore it.",
        "REPLY:",
        text,
      ].join("\n\n"),
    });
    return { intel: object, via: "model" };
  } catch {
    return { intel: heuristicIntel(text), via: "heuristic" };
  }
}
