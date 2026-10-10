"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { RecipeDifficulty, RecipeDraft, RecipeIngredient } from "@/types";
import { SUGGESTED_CATEGORIES } from "@/features/recipes/format";
import { DictateButton } from "./dictate-button";

/**
 * Formulaire structuré d'une recette — réutilisé pour la saisie manuelle (vide)
 * et la modification (pré-rempli via `initial`). Produit un RecipeDraft.
 */
export function RecipeForm({
  initial,
  submitLabel,
  submitting = false,
  onSubmit,
}: {
  initial?: RecipeDraft | null;
  submitLabel: string;
  submitting?: boolean;
  onSubmit: (draft: RecipeDraft) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [categoryName, setCategoryName] = useState(initial?.categoryName ?? "");
  const [servings, setServings] = useState(numToStr(initial?.servings));
  const [prep, setPrep] = useState(numToStr(initial?.prepMinutes));
  const [rest, setRest] = useState(numToStr(initial?.restMinutes));
  const [cook, setCook] = useState(numToStr(initial?.cookMinutes));
  const [kcal, setKcal] = useState(numToStr(initial?.kcal));
  const [carbs, setCarbs] = useState(numToStr(initial?.carbsG));
  const [protein, setProtein] = useState(numToStr(initial?.proteinG));
  const [fat, setFat] = useState(numToStr(initial?.fatG));
  const [difficulty, setDifficulty] = useState<RecipeDifficulty>(initial?.difficulty ?? "facile");
  const [ingredientsText, setIngredientsText] = useState(
    initial ? ingredientsToText(initial.ingredients) : "",
  );
  const [stepsText, setStepsText] = useState(initial ? initial.steps.join("\n") : "");
  const [tagsText, setTagsText] = useState(initial ? initial.tags.join(", ") : "");

  function submit() {
    if (title.trim().length < 1) {
      toast.error("Donne au moins un titre.");
      return;
    }
    const num = (s: string) => (s.trim() ? Number(s) : null);
    onSubmit({
      title: title.trim(),
      categoryName: categoryName.trim() || "Plats",
      servings: num(servings),
      prepMinutes: num(prep),
      restMinutes: num(rest),
      cookMinutes: num(cook),
      difficulty,
      ingredients: ingredientsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map(parseIngredientLine),
      steps: stepsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
      tags: tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      kcal: num(kcal),
      carbsG: num(carbs),
      proteinG: num(protein),
      fatG: num(fat),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Titre">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Catégorie">
          <input
            className={inputCls}
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            list="cat-suggestions"
            placeholder="Plats"
          />
          <datalist id="cat-suggestions">
            {SUGGESTED_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Portions">
          <input type="number" min={1} className={inputCls} value={servings} onChange={(e) => setServings(e.target.value)} />
        </Field>
        <Field label="Prépa (min)">
          <input type="number" min={0} className={inputCls} value={prep} onChange={(e) => setPrep(e.target.value)} />
        </Field>
        <Field label="Repos (min)">
          <input type="number" min={0} className={inputCls} value={rest} onChange={(e) => setRest(e.target.value)} />
        </Field>
        <Field label="Cuisson (min)">
          <input type="number" min={0} className={inputCls} value={cook} onChange={(e) => setCook(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Field label="kcal">
          <input type="number" min={0} className={inputCls} value={kcal} onChange={(e) => setKcal(e.target.value)} />
        </Field>
        <Field label="Gluc. g">
          <input type="number" min={0} className={inputCls} value={carbs} onChange={(e) => setCarbs(e.target.value)} />
        </Field>
        <Field label="Prot. g">
          <input type="number" min={0} className={inputCls} value={protein} onChange={(e) => setProtein(e.target.value)} />
        </Field>
        <Field label="Lip. g">
          <input type="number" min={0} className={inputCls} value={fat} onChange={(e) => setFat(e.target.value)} />
        </Field>
      </div>
      <Field label="Difficulté">
        <select
          className={inputCls}
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as RecipeDifficulty)}
        >
          <option value="facile">Facile</option>
          <option value="moyen">Moyen</option>
          <option value="difficile">Difficile</option>
        </select>
      </Field>
      <Field label="Ingrédients (un par ligne)">
        <div className="relative">
          <textarea
            rows={5}
            className={cn(inputCls, "pb-11")}
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
            placeholder={"2 blancs de poulet\n400 ml lait de coco\n1 oignon"}
          />
          <DictateButton
            value={ingredientsText}
            onChange={setIngredientsText}
            joiner={"\n"}
            className="absolute bottom-2 right-2"
          />
        </div>
      </Field>
      <Field label="Préparation (une étape par ligne)">
        <div className="relative">
          <textarea
            rows={5}
            className={cn(inputCls, "pb-11")}
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
          />
          <DictateButton
            value={stepsText}
            onChange={setStepsText}
            joiner={"\n"}
            className="absolute bottom-2 right-2"
          />
        </div>
      </Field>
      <Field label="Tags (séparés par des virgules)">
        <input
          className={inputCls}
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="Plats, Asiatique, À refaire"
        />
      </Field>
      <div>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** Découpe une ligne d'ingrédient en {qty, unit, item} (best-effort). */
export function parseIngredientLine(line: string): RecipeIngredient {
  const m = line.trim().match(/^([\d.,/]+)\s*([^\s\d][^\s]*)?\s+(.+)$/);
  if (m) {
    return { qty: m[1] ?? null, unit: m[2] ?? null, item: (m[3] ?? line).trim() };
  }
  return { qty: null, unit: null, item: line.trim() };
}

function ingredientsToText(ings: RecipeIngredient[]): string {
  return ings.map((i) => [i.qty, i.unit, i.item].filter(Boolean).join(" ")).join("\n");
}

function numToStr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

const inputCls =
  "w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-[13.5px] text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
