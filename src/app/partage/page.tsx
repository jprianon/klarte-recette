"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

/**
 * Cible de partage de la PWA (Android : « Partager » → Clarté). Le système
 * ouvre /partage?title=…&text=…&url=… ; on transmet le lien à /api/share
 * (authentifié par le cookie de l'app) et on affiche le résultat.
 * Sur iPhone, le même import passe par le Raccourci « Ajouter à Clarté ».
 */
type State = { kind: "loading" } | { kind: "done"; ok: boolean; pending: boolean; message: string };

function ShareImport() {
  const params = useSearchParams();
  const [state, setState] = useState<State>({ kind: "loading" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // une seule fois (StrictMode monte deux fois en dev)
    started.current = true;
    const url = params.get("url") ?? "";
    const text = [params.get("text"), params.get("title")].filter(Boolean).join(" ");
    fetch("/api/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, text }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        setState({
          kind: "done",
          ok: res.ok,
          pending: data?.status === "pending",
          message: data?.message ?? `Erreur ${res.status}`,
        });
      })
      .catch(() =>
        setState({ kind: "done", ok: false, pending: false, message: "Serveur injoignable." }),
      );
  }, [params]);

  const Icon =
    state.kind === "loading" ? Loader2 : !state.ok ? XCircle : state.pending ? Clock : CheckCircle2;

  return (
    <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-sm">
      <Icon
        className={
          "mx-auto mb-3 size-10 " +
          (state.kind === "loading"
            ? "animate-spin text-muted-foreground"
            : state.ok
              ? "text-primary"
              : "text-destructive")
        }
      />
      <h1 className="font-display text-xl font-bold tracking-tight">
        {state.kind === "loading"
          ? "Import de la recette…"
          : state.ok
            ? "C'est noté"
            : "Import impossible"}
      </h1>
      <p className="mt-2 text-[14px] text-muted-foreground">
        {state.kind === "loading"
          ? "L'IA lit la page et prépare la fiche. Ça peut prendre jusqu'à 30 secondes."
          : state.message}
      </p>
      {state.kind === "done" && (
        <Link
          href="/recettes"
          className="mt-5 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm"
        >
          Voir mes recettes
        </Link>
      )}
    </div>
  );
}

export default function PartagePage() {
  return (
    <main
      className="flex min-h-dvh w-full flex-col items-center justify-center bg-background px-5"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Suspense fallback={<Loader2 className="size-8 animate-spin text-muted-foreground" />}>
        <ShareImport />
      </Suspense>
    </main>
  );
}
