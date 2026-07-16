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
        ? "That code isn't right — double-check with whoever invited you."
        : "Something went wrong. Try again.",
    );
    setBusy(false);
  };

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-8 bg-background px-6 text-foreground">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-medium text-4xl tracking-tighter">Vendor Scout</h1>
        <p className="max-w-xs text-muted-foreground text-sm">
          Your AI wedding-vendor researcher. Enter the access code to get started.
        </p>
      </div>
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3">
        <input
          autoFocus
          type="password"
          inputMode="text"
          autoComplete="off"
          placeholder="Access code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-12 rounded-xl border border-input bg-transparent px-4 text-base outline-none focus:border-foreground/40"
        />
        <button
          type="submit"
          disabled={busy || code.trim().length === 0}
          className="h-12 rounded-xl bg-foreground font-medium text-background text-sm disabled:opacity-50"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
        {error ? <p className="text-center text-destructive text-sm">{error}</p> : null}
      </form>
    </main>
  );
}
