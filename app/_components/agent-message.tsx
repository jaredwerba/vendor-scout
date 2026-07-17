"use client";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
} from "eve/react";
import {
  CheckCircleIcon,
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  KeyRoundIcon,
  XCircleIcon,
} from "lucide-react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

type EveFilePart = Extract<EveMessagePart, { type: "file" }>;

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {message.parts.map((part, index) => (
          <AgentMessagePart
            canRespond={canRespond}
            key={partKey(part, index)}
            onInputResponses={onInputResponses}
            part={part}
            showCaret={isStreaming && message.role === "assistant" && index === lastTextIndex}
          />
        ))}
      </MessageContent>
    </Message>
  );
}

function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  showCaret,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      // Venus's inner monologue stays hers — the progress bars, activity
      // chips, and glow tell the couple work is happening.
      return null;
    case "file":
      return <AttachmentPart part={part} />;
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool": {
      const input = (part.input ?? {}) as Record<string, unknown>;
      const hasInputRequest = part.toolMetadata?.eve?.inputRequest !== undefined;
      const isSend = part.toolName === "send_outreach";
      const isDelegation = typeof input.message === "string" && !isSend && !hasInputRequest;

      // Questions & gates: prompt + tappable options, always visible, no JSON.
      if (hasInputRequest) {
        return (
          <div className="venus-rise rounded-2xl border border-accent bg-accent/30 p-4">
            <InputRequestActions
              canRespond={canRespond}
              part={part}
              onInputResponses={onInputResponses}
            />
          </div>
        );
      }
      // Research specialists: a clean progress row — never an expandable field.
      if (isDelegation) {
        return <AgentProgressRow message={String(input.message)} part={part} />;
      }
      // Vendor emails: compact card with the actual email readable on tap.
      if (isSend) {
        return <OutreachCard part={part} />;
      }
      // Everything else (searches, reads, plan upkeep): a quiet one-line chip.
      return <ActivityChip part={part} />;
    }
  }
}

/** A specialist at work: label + living progress bar. No JSON, no expansion. */
function AgentProgressRow({
  message,
  part,
}: {
  readonly message: string;
  readonly part: EveDynamicToolPart;
}) {
  const done = part.state === "output-available";
  const failed = part.state === "output-error" || part.state === "output-denied";
  const { name, phase } = delegationInfo(message);
  return (
    <div className="venus-rise flex items-center gap-3 rounded-2xl border bg-card/60 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">
          {name}
          <span className="ml-2 font-normal text-muted-foreground text-xs">
            {failed ? "hit a snag — regrouping" : done ? "done ✓" : phase + "…"}
          </span>
        </p>
        <div className="venus-progress mt-2" data-state={failed ? "failed" : done ? "done" : "running"}>
          <div className="venus-progress-fill" />
        </div>
      </div>
    </div>
  );
}

/** A sent (or sending) vendor email — the email itself readable on tap, as text. */
function OutreachCard({ part }: { readonly part: EveDynamicToolPart }) {
  const input = (part.input ?? {}) as Record<string, unknown>;
  const done = part.state === "output-available";
  const failed = part.state === "output-error" || part.state === "output-denied";
  const vendor = typeof input.vendor_name === "string" ? input.vendor_name : "a vendor";
  const subject = typeof input.subject === "string" ? input.subject : undefined;
  const body = typeof input.body === "string" ? input.body : undefined;
  return (
    <div
      className={cn(
        "venus-rise rounded-2xl border px-4 py-3",
        failed ? "border-destructive/40 bg-destructive/5" : "bg-card/60",
      )}
    >
      <p className="font-medium text-sm">
        {failed
          ? `Couldn't reach ${vendor} just now — I'll regroup`
          : done
            ? `Email sent to ${vendor} ✓`
            : `Writing to ${vendor}…`}
        {done ? (
          <span className="ml-2 font-normal text-muted-foreground text-xs">tracking replies</span>
        ) : null}
      </p>
      {body ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground text-xs hover:text-foreground">
            read the email
          </summary>
          <div className="mt-2 rounded-xl bg-muted/60 p-3 text-sm leading-relaxed">
            {subject ? <p className="mb-2 font-medium">{subject}</p> : null}
            <p className="whitespace-pre-wrap">{body}</p>
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** Quiet one-liner for searches, page reads, and plan upkeep. */
function ActivityChip({ part }: { readonly part: EveDynamicToolPart }) {
  const done = part.state === "output-available";
  const failed = part.state === "output-error" || part.state === "output-denied";
  return (
    <p className="venus-rise flex items-center gap-2 text-muted-foreground text-xs">
      <span
        className={cn(
          "inline-block size-1.5 shrink-0 rounded-full",
          failed ? "bg-destructive" : done ? "bg-sage" : "animate-pulse bg-rose",
        )}
      />
      {venusActivityLabel(part)}
    </p>
  );
}

/** The Venus activity feed: tool calls narrated like a planner texting you. */

const CATEGORY_HINTS: readonly (readonly [RegExp, string, string])[] = [
  [/venue|estate|barn|farm|ballroom|vineyard|inn\b/i, "Venue agent", "hunting your dream venue"],
  [/photo|videograph/i, "Photography agent", "finding your photographer"],
  [/cater|food|menu|dinner|chef|bar\b/i, "Food & catering agent", "curating your menu"],
  [/floral|florist|flower|bloom|decor/i, "Florals agent", "designing your florals"],
  [/music|dj\b|band|entertain|jazz/i, "Music agent", "booking your sound"],
  [/attire|dress|beauty|hair|makeup/i, "Style agent", "styling your day"],
  [/transport|rental|stationery|cake|favor/i, "Details agent", "handling the finishing touches"],
];

function delegationInfo(message: string): { name: string; phase: string } {
  // Preferred: the briefing declares its category on the first line.
  const declared = /^\s*CATEGORY:\s*(.+)$/im.exec(message)?.[1]?.toLowerCase();
  if (declared) {
    for (const [re, name, doing] of CATEGORY_HINTS) {
      if (re.test(declared)) return { name, phase: doing };
    }
    const clean = declared.replace(/[^a-z& ]/g, "").trim();
    if (clean) {
      return {
        name: `${clean[0].toUpperCase()}${clean.slice(1)} agent`,
        phase: "digging in for you",
      };
    }
  }
  // Fallback: sniff only the OPENING of the briefing — the full brief mentions
  // every category, so scanning it all mislabels (three "Venue agents").
  const head = message.slice(0, 160);
  for (const [re, name, doing] of CATEGORY_HINTS) {
    if (re.test(head)) return { name, phase: doing };
  }
  return { name: "Research agent", phase: "digging in for you" };
}

function venusActivityLabel(part: EveDynamicToolPart): string {
  const input = (part.input ?? {}) as Record<string, unknown>;
  const done = part.state === "output-available";
  const failed = part.state === "output-error" || part.state === "output-denied";
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  if (failed) {
    return "That one didn't go through — adjusting…";
  }

  switch (part.toolName) {
    case "web_search": {
      const q = str(input.query);
      return done ? `Searched: ${q ?? "options"} ✓` : `Searching ${q ?? "for options"}…`;
    }
    case "web_fetch": {
      let host: string | undefined;
      try {
        host = input.url ? new URL(String(input.url)).hostname.replace(/^www\./, "") : undefined;
      } catch {
        host = undefined;
      }
      return done ? `Read ${host ?? "a vendor's site"} ✓` : `Reading ${host ?? "a vendor's site"}…`;
    }
    case "send_outreach": {
      const vendor = str(input.vendor_name);
      return done
        ? `Email sent to ${vendor ?? "a vendor"} ✓ — tracking replies`
        : `Writing to ${vendor ?? "a vendor"} right now…`;
    }
    case "check_outreach_status":
      return done ? "Checked every vendor thread ✓" : "Checking who's written back…";
    case "cancel_followups":
      return "Closing that thread for you…";
    case "ask_question":
      return "Quick thing — I need your take";
    case "todo":
      return done ? "Plan updated ✓" : "Organizing my plan…";
    default:
      return done ? "Done ✓" : "On it for you…";
  }
}

function AttachmentPart({ part }: { readonly part: EveFilePart }) {
  const label = part.filename ?? "Attachment";
  const detail = [part.mediaType, formatBytes(part.size)].filter(Boolean).join(" - ");
  const isImage = part.mediaType.startsWith("image/") && part.url !== undefined;
  const Icon = isImage ? ImageIcon : FileIcon;
  const body = (
    <span className="flex max-w-sm items-center gap-3 rounded-md border bg-background/60 p-2 text-sm">
      {isImage ? (
        <img alt={label} className="size-12 shrink-0 rounded-sm object-cover" src={part.url} />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {detail ? <span className="block truncate text-muted-foreground">{detail}</span> : null}
      </span>
      {part.url ? <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" /> : null}
    </span>
  );

  return part.url ? (
    <a href={part.url} rel="noreferrer" target="_blank">
      {body}
    </a>
  ) : (
    body
  );
}

function AuthorizationPrompt({ part }: { readonly part: EveAuthorizationPart }) {
  const isAuthorized = part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized ? CheckCircleIcon : isCompleted ? XCircleIcon : KeyRoundIcon;
  const instructions = part.authorization?.instructions;
  const shouldShowInstructions = instructions !== undefined && instructions !== part.description;

  return (
    <div
      className={cn(
        "space-y-3 rounded-md border p-3",
        isAuthorized
          ? "border-emerald-500/30 bg-emerald-500/5"
          : isCompleted
            ? "border-destructive/30 bg-destructive/5"
            : "border-blue-500/30 bg-blue-500/5",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            isAuthorized
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : isCompleted
                ? "bg-destructive/10 text-destructive"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-300",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-sm">{authorizationTitle(part)}</p>
          <p className="text-muted-foreground text-sm">{authorizationDescription(part)}</p>
          {shouldShowInstructions ? (
            <p className="text-muted-foreground text-sm">{instructions}</p>
          ) : null}
          {part.state === "required" && part.authorization?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Code</span>
              <code className="rounded-md bg-background px-2 py-1 font-mono">
                {part.authorization.userCode}
              </code>
            </div>
          ) : null}
          {part.state === "required" && part.authorization?.url ? (
            <Button asChild size="sm">
              <a href={part.authorization.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-4" />
                Sign in with {part.displayName}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return `Connect ${part.displayName}`;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected`;
  }
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return part.description;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected.`;
  }
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}${tail}.`;
}

function formatAuthorizationOutcome(outcome: NonNullable<EveAuthorizationPart["outcome"]>): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }
}

function formatBytes(size: number | undefined): string | undefined {
  if (size === undefined) {
    return undefined;
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) {
    return null;
  }

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId,
  );
  // A degenerate question (junk/placeholder prompt, no tappable options) must
  // never dead-end the couple — typed answers always resolve a parked question.
  const options = inputRequest.options ?? [];
  const promptLooksBroken =
    !inputRequest.prompt || inputRequest.prompt.trim().length < 12;
  const displayPrompt = promptLooksBroken
    ? "I need your go-ahead here — tell me which way you'd like to go."
    : inputRequest.prompt;

  return (
    <div className="space-y-3">
      <p className="font-medium text-sm leading-relaxed">{displayPrompt}</p>
      {inputResponse ? (
        <p className="text-muted-foreground text-sm">
          You chose:{" "}
          <span className="font-medium text-foreground">
            {selectedOption?.label ?? inputResponse.text ?? inputResponse.optionId}
          </span>
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {options.map((option) => (
            <Button
              className={cn(
                "venus-bloom h-11 justify-center rounded-full px-5 font-medium text-sm sm:h-10",
                option.style === "danger" ? "" : "bg-primary text-primary-foreground",
              )}
              disabled={!canRespond}
              key={option.id}
              onClick={() => {
                void onInputResponses([
                  {
                    optionId: option.id,
                    requestId: inputRequest.requestId,
                  },
                ]);
              }}
              size="sm"
              type="button"
              variant={option.style === "danger" ? "destructive" : "default"}
            >
              {option.label}
            </Button>
          ))}
          {inputRequest.allowFreeform || options.length === 0 ? (
            <p className="self-center text-muted-foreground text-xs sm:ml-1">
              …{options.length === 0 ? "type your answer below and I'll pick it up" : "or just type your answer below"}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
