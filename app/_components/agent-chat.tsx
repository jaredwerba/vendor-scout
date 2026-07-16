"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon, CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";

const AGENT_NAME = "Vendor Scout";

const ONE_SHOT_TEMPLATE = `Plan my wedding:
- Budget: $28,000 total
- Date: September 11, 2027 (flexible ±2 weeks)
- Location: within 45 min of Methuen, MA
- Guests: ~50
- Style: boho, outdoorsy, relaxed
- Priorities: venue + food first, then photography
- Skip: (anything already booked)`;

function TemplateCard() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(ONE_SHOT_TEMPLATE).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-muted/30 p-4 text-left">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          One message is all it takes
        </p>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-muted"
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap font-mono text-[13px] text-foreground/90 leading-relaxed">
        {ONE_SHOT_TEMPLATE}
      </pre>
      <p className="mt-3 text-muted-foreground text-xs">
        Copy it, swap in your details, send. Budget, date, location, guests, and style are the five
        that matter — give all five and planning starts instantly: budget split, then parallel
        research across venue, catering, photo, florals, and music, then one master plan with the
        option to email vendors for you.
      </p>
    </div>
  );
}

type AgentStatus = ReturnType<typeof useEveAgent>["status"];

export function AgentChat() {
  const agent = useEveAgent();
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isBusy) return;

    if (message.files.length === 0) {
      await agent.send({ message: text });
      return;
    }

    const parts: UserContent = [];
    if (text.length > 0) {
      parts.push({ text, type: "text" });
    }
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }

    await agent.send({ message: parts });
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder="Send a message…" />
      <PromptInputSubmit onStop={agent.stop} status={agent.status} />
    </PromptInput>
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {isEmpty ? null : (
        <header className="flex h-14 shrink-0 items-center justify-center gap-3 pl-4 pr-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-muted-foreground text-sm">{AGENT_NAME}</span>
            <StatusDot status={agent.status} />
          </span>
        </header>
      )}

      {agent.error ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 sm:px-6">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Request failed</p>
              <p className="mt-0.5 text-muted-foreground">{agent.error.message}</p>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? null : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6">
            {agent.data.messages.map((message, index) => (
              <AgentMessage
                canRespond={!isBusy}
                isStreaming={
                  agent.status === "streaming" && index === agent.data.messages.length - 1
                }
                key={message.id}
                message={message}
                onInputResponses={(inputResponses) => agent.send({ inputResponses })}
              />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          isEmpty
            ? "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]"
            : "max-w-3xl shrink-0 pb-6",
        )}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex flex-col items-center gap-2">
              <h1 className="font-medium text-5xl tracking-tighter">{AGENT_NAME}</h1>
              <p className="max-w-sm text-muted-foreground text-sm">
                Your AI wedding planner — research, comparisons, and vendor outreach, done for you.
              </p>
            </div>
            <TemplateCard />
          </div>
        ) : null}
        <div className="w-full">{composer}</div>
      </div>
    </main>
  );
}

function StatusDot({ status }: { readonly status: AgentStatus }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone =
    status === "error"
      ? "bg-destructive"
      : isLive
        ? "bg-emerald-500"
        : status === "ready"
          ? "bg-muted-foreground"
          : "bg-muted-foreground/50";

  return (
    <span className="relative flex size-1">
      {isLive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            tone,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-1 rounded-full transition-colors", tone)} />
    </span>
  );
}
