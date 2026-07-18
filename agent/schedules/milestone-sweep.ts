import { defineSchedule } from "eve/schedules";
import { notifyCouple } from "../lib/resend";
import {
  daysUntil,
  dueForCheckin,
  getTimelineMeta,
  markNotified,
  timelineConfigured,
} from "../lib/timeline";

/**
 * Venus's shoulder-tap: once a day (offset from the follow-up sweep), gather
 * every milestone entering its window and send ONE warm check-in digest.
 * Deterministic template, no model call, idempotent per day (a re-run can't
 * double-send: milestones are marked with today's date before we return).
 */
export default defineSchedule({
  cron: "45 14 * * *",
  run({ waitUntil }) {
    waitUntil(
      (async () => {
        if (!timelineConfigured()) return;
        const meta = await getTimelineMeta();
        if (!meta?.couple_email) return; // nowhere to check in
        const now = new Date();
        const due = await dueForCheckin(now);
        if (due.length === 0) return;

        const toGo = daysUntil(meta.wedding_date, now);
        const name = meta.couple_names ? ` ${meta.couple_names}` : "";
        const lines = due.map((m) => {
          const d = daysUntil(m.due_date, now);
          const when = d < 0 ? "a little overdue — no panic" : d === 0 ? "today!" : `in ${d} days`;
          return `• ${m.title} (${when})\n  ${m.detail}`;
        });

        const ok = await notifyCouple(
          `${toGo} days to go — ${due.length === 1 ? "one thing" : `${due.length} things`} coming up 🤍`,
          [
            `Hi${name}! Quick check-in from me — here's what's approaching on your Countdown:`,
            "",
            ...lines,
            "",
            "Want a hand with any of these? Open Venus and just say the word — I can research, email vendors, or cross things off for you.",
            "Your full Countdown lives at /my-wedding.",
            "",
            "— V 🤍",
          ].join("\n"),
          `checkin:${now.toISOString().slice(0, 10)}`,
          meta.couple_email,
        );
        if (ok) await markNotified(due.map((m) => m.id), now);
      })(),
    );
  },
});
