import { NextResponse } from "next/server";

import { importRecipeFromUrl } from "@/features/recipes/url-import";

/**
 * POST /api/recipes/url — corps = { url }.
 * Récupère la page et la met en fiche via l'IA (cf. url-import.ts : JSON-LD,
 * légende og:, pins Pinterest suivis jusqu'au site source). Renvoie { draft,
 * imageUrl } comme /api/recipes/format. Best-effort : dépend du site source.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!/^https?:\/\/.+/i.test(url)) {
    return NextResponse.json(
      { error: "bad_url", message: "Lien invalide (https://…)." },
      { status: 400 },
    );
  }

  const result = await importRecipeFromUrl(url);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    );
  }
  return NextResponse.json({ draft: result.draft, imageUrl: result.imageUrl });
}
