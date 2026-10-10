"use client";

import { useState } from "react";
import { Link2, Loader2, Save, Wand2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { RecipeDraft } from "@/types";
import { createRecipe, draftToView, formatRecipe, importUrl } from "@/features/recipes/service";
import { DictateButton } from "./dictate-button";
import { RecipeForm } from "./recipe-form";
import { RecipeTemplate } from "./recipe-template";

/** Ce que l'écran d'ajout renvoie à traiter en tâche de fond. */
export type RecipeJobInput =
  | { kind: "ai"; note: string }
  | { kind: "ocr"; file: File }
  | { kind: "url"; url: string };

/** Point d'entrée choisi depuis le menu « Ajouter une recette ». */
export type AddMode = "ai" | "url" | "manual";

/**
 * Écran d'ajout d'une recette, piloté par `mode` (choisi dans le menu) :
 * - `ai`     : note libre → l'IA la met en fiche.
 * - `url`    : lien d'une page → import + IA.
 * - `manual` : formulaire structuré.
 *
 * Base branchée : les traitements lents (IA, URL) sont confiés à `onQueue`
 * (tâche de fond) qui rend la main aussitôt. En mode démo (pas de base), on
 * garde l'aperçu inline puisqu'on ne peut rien enregistrer.
 */
export function AiCaptureCard({
  mode = "ai",
  canSave,
  onSaved,
  onQueue,
}: {
  mode?: AddMode;
  canSave: boolean;
  onSaved: () => void;
  onQueue?: (input: RecipeJobInput) => void;
}) {
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [rawNote, setRawNote] = useState<string | null>(null);
  const [source, setSource] = useState<"ai" | "manual">("ai");

  async function submitAi() {
    if (note.trim().length < 3) {
      toast.error("Écris quelques mots de recette d'abord.");
      return;
    }
    if (canSave && onQueue) {
      onQueue({ kind: "ai", note: note.trim() });
      return;
    }
    setBusy(true);
    try {
      setDraft(await formatRecipe(note.trim()));
      setRawNote(note.trim());
      setSource("ai");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Le reformatage a échoué.");
    } finally {
      setBusy(false);
    }
  }

  async function submitUrl() {
    const u = url.trim();
    if (!/^https?:\/\/.+/i.test(u)) {
      toast.error("Colle un lien valide (https://…).");
      return;
    }
    if (canSave && onQueue) {
      onQueue({ kind: "url", url: u });
      return;
    }
    setBusy(true);
    try {
      setDraft((await importUrl(u)).draft);
      setRawNote(u);
      setSource("ai");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  }

  function handleManualSubmit(d: RecipeDraft) {
    setDraft(d);
    setRawNote(null);
    setSource("manual");
  }

  async function handleSave() {
    if (!draft) return;
    if (!canSave) {
      toast.error("Base non configurée : impossible d'enregistrer.");
      return;
    }
    setSaving(true);
    try {
      await createRecipe(draft, rawNote, source);
      toast.success(`« ${draft.title} » ajoutée au carnet.`);
      setDraft(null);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "L'enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  }

  // Aperçu (mode démo IA/URL, et toujours pour la saisie manuelle).
  if (draft) {
    return (
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide">
          <span className="size-[7px] rounded-full bg-primary" />
          <span className="text-primary">Aperçu</span>
          <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-muted-foreground">
            {draft.categoryName}
          </span>
        </div>
        <div className="p-4">
          <RecipeTemplate view={draftToView(draft)} />
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Button onClick={handleSave} disabled={saving || !canSave}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Enregistrer
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
              <X className="size-4" />
              Rejeter
            </Button>
            {!canSave && (
              <span className="text-xs text-muted-foreground">
                Base non configurée — enregistrement indisponible.
              </span>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (mode === "manual") {
    return <RecipeForm submitLabel="Prévisualiser" onSubmit={handleManualSubmit} />;
  }

  if (mode === "url") {
    return (
      <div className="flex flex-col gap-3">
        <input
          type="url"
          inputMode="url"
          autoCapitalize="none"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://exemple.com/ma-recette"
          className="w-full rounded-2xl border border-border bg-secondary/40 p-4 text-[14px] text-foreground/80 placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-[12.5px] text-muted-foreground">
          Colle le lien d&apos;une recette (blog, site de cuisine…). L&apos;IA en extrait la fiche.
        </p>
        <Button onClick={submitUrl} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          {busy ? "Import…" : "Importer la recette"}
        </Button>
      </div>
    );
  }

  // mode === "ai"
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={6}
          placeholder={
            "poulet curry coco pour 4\n2 blancs de poulet, une boîte de lait coco, oignon, ail, 2 cs de pâte de curry rouge…\nfaire revenir oignon ail, ajouter poulet, déglacer au lait coco, mijoter 20 min. riz à côté.\nenv 30 min, on adore"
          }
          className="w-full resize-y rounded-2xl border border-border bg-secondary/40 p-4 pb-12 text-[13.5px] leading-relaxed text-foreground/80 placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <DictateButton value={note} onChange={setNote} className="absolute bottom-3 right-3" />
      </div>
      <p className="-mt-1 text-[12.5px] text-muted-foreground">
        Écris ou appuie sur le micro pour dicter ta recette, même en vrac.
      </p>
      <Button onClick={submitAi} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
        {busy ? "Reformatage…" : "Générer la recette"}
      </Button>
    </div>
  );
}
