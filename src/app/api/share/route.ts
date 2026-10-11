import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { dbCreateRecipe, dbSetImage, hasDb } from "@/lib/db";
import { fetchRemoteImage, importRecipeFromUrl } from "@/features/recipes/url-import";

/**
 * POST /api/share — « Partager vers Clarté » (Raccourci iOS, partage Android).
 * Corps JSON : { url } ou { text } (le 1er lien du texte est utilisé).
 * Importe la recette (Pinterest suivi jusqu'au site source), la met en fiche
 * via l'IA, l'enregistre avec sa photo.
 *
 * Accès : ce chemin est exempté du middleware et vérifie lui-même le code
 * d'accès, passé en en-tête `x-access-code` (Raccourci) ou via le cookie de
 * l'app (partage depuis la PWA).
 *
 * Réponse : on attend le résultat jusqu'à WAIT_MS. Au-delà (IA lente), on
 * répond « en cours » et l'import se termine en tâche de fond : la recette
 * apparaît dans le carnet quand elle est prête. `message` est prêt à afficher.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const WAIT_MS = 25_000;

function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function authorized(request: Request): boolean {
  const code = process.env.ACCESS_CODE;
  if (!code) return true; // protection désactivée (comme le middleware)
  const header = request.headers.get("x-access-code");
  if (header && sameSecret(header.trim(), code)) return true;
  const cookie = request.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)klarte_access=([^;]+)/);
  return !!m?.[1] && sameSecret(decodeURIComponent(m[1]), code);
}

/** Premier lien http(s) d'un texte partagé (« Regarde ce pin ! https://pin.it/… »). */
function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,;!?»]+$/, "") : null;
}

type ShareOutcome =
  | { ok: true; id: string; title: string }
  | { ok: false; status: number; error: string; message: string };

async function importAndSave(url: string): Promise<ShareOutcome> {
  const result = await importRecipeFromUrl(url);
  if (!result.ok) return result;

  const recipe = await dbCreateRecipe(result.draft, result.sourceUrl, "ai");
  if (result.imageUrl) {
    const img = await fetchRemoteImage(result.imageUrl);
    if (img) {
      await dbSetImage(recipe.id, img.contentType, img.buf).catch((e) =>
        console.error("[api/share] photo non enregistrée", e),
      );
    }
  }
  return { ok: true, id: recipe.id, title: recipe.title };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", message: "Code d'accès manquant ou incorrect." },
      { status: 401 },
    );
  }
  if (!hasDb()) {
    return NextResponse.json(
      { ok: false, error: "not_configured", message: "Base non configurée sur le serveur." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const raw = [body?.url, body?.text].find(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  const url = raw ? (/^https?:\/\//i.test(raw.trim()) ? raw.trim() : firstUrl(raw)) : null;
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "bad_url", message: "Aucun lien trouvé dans ce partage." },
      { status: 400 },
    );
  }

  const job = importAndSave(url).catch((e): ShareOutcome => {
    console.error("[api/share]", e);
    return {
      ok: false,
      status: 500,
      error: "save_failed",
      message: e instanceof Error ? e.message : "Enregistrement impossible.",
    };
  });
  const timeout = new Promise<"pending">((resolve) =>
    setTimeout(() => resolve("pending"), WAIT_MS),
  );
  const outcome = await Promise.race([job, timeout]);

  if (outcome === "pending") {
    // L'import continue en tâche de fond (serveur Node persistant).
    void job.then((o) => {
      if (!o.ok) console.error("[api/share] import en arrière-plan échoué :", url, o.message);
    });
    return NextResponse.json(
      {
        ok: true,
        status: "pending",
        message: "Import en cours : la recette apparaîtra dans Clarté d'ici une minute.",
      },
      { status: 202 },
    );
  }
  if (!outcome.ok) {
    return NextResponse.json(
      { ok: false, error: outcome.error, message: outcome.message },
      { status: outcome.status },
    );
  }
  return NextResponse.json({
    ok: true,
    status: "saved",
    id: outcome.id,
    title: outcome.title,
    message: `« ${outcome.title} » ajoutée à Clarté.`,
  });
}
