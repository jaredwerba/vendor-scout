"use client";

import { useState } from "react";

export default function UnlockPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    }).catch(() => null);
    if (res?.ok) {
      window.location.href = "/";
      return;
    }
    setError(
      res && res.status === 401
        ? "That code isn't one of mine. Check it once more, or ask whoever invited you."
        : "Something went astray. Try once more.",
    );
    setBusy(false);
  };

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-8 bg-background px-6 text-foreground">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="venus-script text-7xl leading-none text-primary">Venus</h1>
        <h2 className="venus-serif text-xl">Venus is by invitation</h2>
        <p className="max-w-xs text-muted-foreground text-sm leading-relaxed">
          Enter your access code and we'll begin where every great wedding begins — with a
          conversation.
        </p>
      </div>
      <form onSubmit={submit} className="venus-texture flex w-full max-w-xs flex-col gap-3 rounded-3xl border bg-card p-5 shadow-[0_18px_50px_-24px_rgba(160,90,100,0.35)]">
        <input
          autoFocus
          type="password"
          inputMode="text"
          autoComplete="off"
          placeholder="Your access code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-12 rounded-2xl border border-input bg-background px-4 text-base outline-none focus:border-ring"
        />
        <button
          type="submit"
          disabled={busy || code.trim().length === 0}
          className="venus-bloom h-12 rounded-2xl bg-primary font-medium text-primary-foreground text-sm disabled:opacity-50"
        >
          {busy ? "One moment…" : "Come in"}
        </button>
        {error ? <p className="text-center text-destructive text-sm">{error}</p> : null}
      </form>
    </main>
  );
}
