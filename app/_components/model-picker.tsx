"use client";

import { ChevronDownIcon, CpuIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { type ModelChoice, PLANNER_CHOICES } from "@/agent/lib/model-choice";
import { cn } from "@/lib/utils";

export const MODEL_STORAGE_KEY = "venus_planner_model";

/** Read the stored choice. Returns null for "use the deployment default". */
export function storedPlannerModel(): string | null {
  try {
    const v = localStorage.getItem(MODEL_STORAGE_KEY);
    return v && PLANNER_CHOICES.some((c) => c.id === v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Choose the planner's model, with the measurement next to each option.
 *
 * A plain dropdown of model names would invite exactly the mistake this
 * project already made twice — picking on price and discovering the failure
 * afterwards. Each option carries what was actually measured here, and the
 * two risky ones say so.
 *
 * The choice takes effect on the next turn: it travels as a header, the
 * channel validates it against the allowlist, and a dynamic resolver applies
 * it at step.started.
 */
export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  readonly value: string | null;
  readonly onChange: (id: string | null) => void;
  readonly disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current: ModelChoice | undefined =
    PLANNER_CHOICES.find((c) => c.id === value) ?? PLANNER_CHOICES[0];

  if (!mounted) return null;

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/50",
          disabled && "cursor-not-allowed opacity-60",
        )}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <CpuIcon className="size-3 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-mono">{current?.label}</span>
        {current?.caution ? <TriangleAlertIcon className="size-3 shrink-0 text-destructive" /> : null}
        <ChevronDownIcon className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute right-0 bottom-full z-20 mb-1.5 w-[min(22rem,80vw)] overflow-hidden rounded-xl border bg-popover shadow-xl">
          <p className="border-b bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground leading-relaxed">
            The planner's model, applied on the next message. The research specialists stay
            pinned — they are most of the cost and the place a bad model does real damage.
          </p>
          <ul className="max-h-[19rem] overflow-y-auto">
            {PLANNER_CHOICES.map((c) => (
              <li key={c.id}>
                <button
                  className={cn(
                    "w-full border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/50",
                    c.id === current?.id && "bg-primary/5",
                  )}
                  onClick={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                  type="button"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-xs">{c.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                      {c.price}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground leading-relaxed">
                    {c.evidence}
                  </span>
                  {c.caution ? (
                    <span className="mt-1 flex items-start gap-1 text-[11px] text-destructive leading-relaxed">
                      <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
                      {c.caution}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
