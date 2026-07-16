"use client";

import { MicIcon, SquareIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Voice for Venus — zero-backend, zero-cost, browser-native:
 *  - Mic: Web Speech API streams what the couple says straight into the
 *    composer (they review, edit, and send — speech never auto-sends).
 *  - Voice replies: speechSynthesis reads Venus's completed messages aloud
 *    with the warmest female voice the device offers. Off by default.
 * Browsers without support simply never show the buttons.
 */

// ——— minimal Web Speech typings (not in lib.dom for all configs) ———
type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Write a value into a React-controlled textarea so state stays in sync. */
function setTextareaValue(ta: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(ta, value);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

export function MicButton({
  disabled,
  targetSelector,
}: {
  readonly disabled: boolean;
  readonly targetSelector: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    const ta = document.querySelector<HTMLTextAreaElement>(targetSelector);
    if (!Ctor || !ta) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    baseRef.current = ta.value ? `${ta.value.trim()} ` : "";
    finalRef.current = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += `${r[0].transcript} `;
        else interim += r[0].transcript;
      }
      const el = document.querySelector<HTMLTextAreaElement>(targetSelector);
      if (el) setTextareaValue(el, (baseRef.current + finalRef.current + interim).trimStart());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [targetSelector]);

  useEffect(() => () => recRef.current?.stop(), []);

  if (!supported) return null;
  return (
    <button
      aria-label={listening ? "Stop listening" : "Describe your wedding out loud"}
      aria-pressed={listening}
      className={cn(
        "venus-bloom flex size-12 shrink-0 items-center justify-center rounded-full border transition-colors",
        listening
          ? "border-rose bg-rose text-primary-foreground"
          : "border-input bg-card text-foreground hover:border-ring",
        disabled && "pointer-events-none opacity-40",
      )}
      disabled={disabled}
      onClick={listening ? stop : start}
      type="button"
    >
      {listening ? (
        <span className="relative flex items-center justify-center">
          <span className="absolute inline-flex size-8 animate-ping rounded-full bg-primary-foreground opacity-30" />
          <SquareIcon className="relative size-4" fill="currentColor" />
        </span>
      ) : (
        <MicIcon className="size-5" />
      )}
    </button>
  );
}

// ——— Venus speaks ———

const VOICE_PREF_KEY = "venus_voice_on";

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => v.lang.startsWith("en"));
  const preferred =
    en.find((v) => /samantha|aria|jenny|ava|allison|zira|victoria|serena|karen/i.test(v.name)) ??
    en.find((v) => /female|woman/i.test(v.name)) ??
    en.find((v) => v.default) ??
    en[0];
  return preferred ?? null;
}

function cleanForSpeech(markdown: string): string {
  let t = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/^\|.*\|$/gm, "") // table rows
    .replace(/[#*_`>~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Long plans are for reading; speak the opening beat only.
  if (t.length > 550) {
    const cut = t.slice(0, 550);
    t = `${cut.slice(0, Math.max(cut.lastIndexOf(". "), 200) + 1)} …the rest is on your screen!`;
  }
  return t;
}

export function useSpokenReplies(lastAssistantText: string | null, isBusy: boolean) {
  const [voiceOn, setVoiceOn] = useState(false);
  const [supported, setSupported] = useState(false);
  const lastSpokenRef = useRef<string | null>(null);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "speechSynthesis" in window;
    setSupported(ok);
    if (ok) {
      setVoiceOn(localStorage.getItem(VOICE_PREF_KEY) === "1");
      window.speechSynthesis.getVoices(); // warm the voice list
    }
  }, []);

  const toggle = useCallback(() => {
    setVoiceOn((v) => {
      const next = !v;
      localStorage.setItem(VOICE_PREF_KEY, next ? "1" : "0");
      if (!next) window.speechSynthesis.cancel();
      return next;
    });
  }, []);

  useEffect(() => {
    if (!supported || !voiceOn || isBusy || !lastAssistantText) return;
    if (lastSpokenRef.current === lastAssistantText) return;
    lastSpokenRef.current = lastAssistantText;
    const text = cleanForSpeech(lastAssistantText);
    if (!text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = 1.06; // bubbly, not rushed
    u.pitch = 1.12;
    window.speechSynthesis.speak(u);
  }, [supported, voiceOn, isBusy, lastAssistantText]);

  return { supported, voiceOn, toggle };
}

export function SpeakerToggle({
  on,
  onToggle,
}: {
  readonly on: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-label={on ? "Venus voice on — tap to mute" : "Hear Venus out loud"}
      aria-pressed={on}
      className={cn(
        "flex size-8 items-center justify-center rounded-full border transition-colors",
        on
          ? "border-rose bg-accent text-accent-foreground"
          : "border-transparent text-muted-foreground hover:border-input",
      )}
      onClick={onToggle}
      type="button"
    >
      {on ? <Volume2Icon className="size-4" /> : <VolumeXIcon className="size-4" />}
    </button>
  );
}
