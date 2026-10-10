"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";

/** Écran de code d'accès partagé (aucun compte : un seul code commun). */
export default function AccesPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/acces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setError("Code incorrect.");
        setBusy(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next && next.startsWith("/") ? next : "/recettes");
    } catch {
      setError("Erreur réseau, réessaie.");
      setBusy(false);
    }
  }

  return (
    <main
      className="flex min-h-dvh w-full flex-col items-center justify-center bg-gradient-to-b from-background to-secondary/50 px-5"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-sm animate-fade-in rounded-3xl border border-border bg-card p-6 shadow-sm"
      >
        <span className="mx-auto mb-4 grid size-14 place-items-center rounded-[18px] bg-primary text-primary-foreground shadow-lg">
          <Lock className="size-7" />
        </span>
        <h1 className="text-center font-display text-2xl font-bold tracking-tight">Clarté</h1>
        <p className="mt-1 text-center text-[14px] text-muted-foreground">
          Entre le code d&apos;accès partagé.
        </p>

        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          placeholder="Code"
          className="mt-5 w-full rounded-xl border border-border bg-secondary/40 px-4 py-3 text-center text-[16px] tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {error && <p className="mt-3 text-center text-[13px] text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={busy || code.trim().length === 0}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[15px] font-semibold text-primary-foreground shadow-sm active:scale-[0.99] disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Entrer
        </button>
      </form>
    </main>
  );
}
