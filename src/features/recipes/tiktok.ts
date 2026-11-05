/**
 * Import d'une vidéo TikTok (côté serveur uniquement).
 *
 * La page TikTok est une appli JS : le scraping générique n'y trouve au mieux
 * qu'une légende tronquée. On passe donc par :
 *   1. le lien court (vm.tiktok.com / tiktok.com/t/…) résolu vers la vidéo ;
 *   2. l'oEmbed officiel → légende COMPLÈTE + miniature (fiable, sans blocage) ;
 *   3. les données embarquées de la page (best-effort) → légende, couverture
 *      et surtout les SOUS-TITRES AUTOMATIQUES : quand la recette est dite à
 *      l'oral, c'est la transcription qui la contient.
 * Le texte assemblé (légende + transcription) part ensuite à l'IA, qui le met
 * au format fixe du carnet, comme pour tous les autres imports.
 */

const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1";

const TIKTOK_HOST = /(^|\.)tiktok\.com$/i;
/** Longueur max de la transcription donnée à l'IA (contexte Ollama 4096 tokens). */
const TRANSCRIPT_MAX = 5000;

export function isTikTok(host: string): boolean {
  return TIKTOK_HOST.test(host);
}

async function get(url: string, ms: number, accept: string, referer?: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const headers: Record<string, string> = {
      "user-agent": SAFARI_UA,
      accept,
      "accept-language": "fr-FR,fr;q=0.9,en;q=0.7",
    };
    if (referer) headers.referer = referer;
    return await fetch(url, { signal: ctrl.signal, redirect: "follow", headers });
  } finally {
    clearTimeout(timer);
  }
}

/** Identifiant de la vidéo dans une URL TikTok (/video/123, /photo/123, /v/123.html). */
export function tiktokVideoId(url: string): string | null {
  return url.match(/\/(?:video|photo|v)\/(\d{8,})/)?.[1] ?? null;
}

/** URL canonique sans paramètres de suivi (?_r=1&_t=…). */
function canonical(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

type OEmbed = { title?: string; author_name?: string; thumbnail_url?: string };

async function fetchOEmbed(videoUrl: string): Promise<OEmbed | null> {
  try {
    const res = await get(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`,
      12_000,
      "application/json",
    );
    if (!res.ok) return null;
    return (await res.json()) as OEmbed;
  } catch {
    return null;
  }
}

type Subtitle = { lang: string; url: string; format: string };
type ItemData = { desc: string; covers: string[]; subtitles: Subtitle[] };

/** Cherche récursivement l'objet de la vidéo (id = videoId, avec `desc`). */
function findItem(node: unknown, id: string | null, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || depth > 12) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findItem(n, id, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const o = node as Record<string, unknown>;
  if (typeof o.desc === "string" && o.video && (!id || String(o.id) === id)) return o;
  for (const v of Object.values(o)) {
    const r = findItem(v, id, depth + 1);
    if (r) return r;
  }
  return null;
}

/** Données embarquées de la page vidéo (__UNIVERSAL_DATA_FOR_REHYDRATION__ / SIGI_STATE). */
function parsePageData(html: string, id: string | null): ItemData | null {
  const scripts = html.matchAll(
    /<script[^>]+id=["'](?:__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE|__NEXT_DATA__)["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of scripts) {
    let json: unknown;
    try {
      json = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const item = findItem(json, id);
    if (!item) continue;

    const video = (item.video ?? {}) as Record<string, unknown>;
    const covers = ["originCover", "cover", "dynamicCover"]
      .map((k) => video[k])
      .filter((v): v is string => typeof v === "string" && v.startsWith("http"));

    const subtitles: Subtitle[] = [];
    const infos = video.subtitleInfos ?? video.subtitles;
    if (Array.isArray(infos)) {
      for (const s of infos as Record<string, unknown>[]) {
        const url = s.Url ?? s.url;
        if (typeof url !== "string" || !url.startsWith("http")) continue;
        subtitles.push({
          lang: String(s.LanguageCodeName ?? s.languageCodeName ?? s.LanguageID ?? ""),
          url,
          format: String(s.Format ?? s.format ?? "webvtt"),
        });
      }
    }
    return { desc: String(item.desc ?? ""), covers, subtitles };
  }
  return null;
}

/** Sous-titres préférés : français, puis anglais, puis le premier disponible. */
function pickSubtitle(subs: Subtitle[]): Subtitle | null {
  const rank = (s: Subtitle) =>
    /^fr|fra/i.test(s.lang) ? 0 : /^en|eng/i.test(s.lang) ? 1 : 2;
  return [...subs].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** WebVTT / SRT → texte continu (sans horodatage ni doublons consécutifs). */
export function subtitlesToText(raw: string): string {
  const lines: string[] = [];
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const t = line.replace(/<[^>]+>/g, "").trim();
    if (!t || t === "WEBVTT" || /^\d+$/.test(t) || t.includes("-->") || /^(NOTE|STYLE)\b/.test(t))
      continue;
    if (lines[lines.length - 1] !== t) lines.push(t);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchTranscript(sub: Subtitle, referer: string): Promise<string> {
  try {
    const res = await get(sub.url, 12_000, "text/vtt,text/plain,*/*", referer);
    if (!res.ok) return "";
    return subtitlesToText(await res.text()).slice(0, TRANSCRIPT_MAX);
  } catch {
    return "";
  }
}

export type TikTokSource =
  | { ok: true; text: string; images: string[]; sourceUrl: string }
  | { ok: false; status: number; error: string; message: string };

/**
 * Rassemble tout ce qui décrit la recette d'une vidéo TikTok : légende
 * complète (oEmbed, sinon page) + transcription des sous-titres automatiques.
 */
export async function tiktokRecipeSource(url: string): Promise<TikTokSource> {
  // 1. Lien court → URL de la vidéo (la page récupérée sert aussi à l'étape 3).
  let finalUrl = url;
  let html = "";
  try {
    const res = await get(url, 15_000, "text/html,application/xhtml+xml");
    finalUrl = res.url || url;
    if (res.ok) html = await res.text();
  } catch {
    /* page injoignable : l'oEmbed peut suffire */
  }

  const id = tiktokVideoId(finalUrl) ?? tiktokVideoId(url);
  const videoUrl = canonical(tiktokVideoId(finalUrl) ? finalUrl : url);

  // 2. oEmbed (légende complète + miniature) et 3. données de la page, en parallèle.
  const [oembed, page] = await Promise.all([
    fetchOEmbed(videoUrl),
    Promise.resolve(html ? parsePageData(html, id) : null),
  ]);

  const caption = (oembed?.title || page?.desc || "").trim();
  const sub = page ? pickSubtitle(page.subtitles) : null;
  const transcript = sub ? await fetchTranscript(sub, videoUrl) : "";

  if (caption.length < 30 && transcript.length < 30) {
    if (!oembed && !page) {
      return {
        ok: false,
        status: 502,
        error: "tiktok_unreachable",
        message: "TikTok n'a pas répondu (vidéo privée, supprimée ou lien invalide ?).",
      };
    }
    return {
      ok: false,
      status: 422,
      error: "empty_text",
      message:
        "La recette n'est ni dans la légende ni dans les sous-titres de cette vidéo. Astuce : dicte-la dans « Générateur de recette ».",
    };
  }

  const parts = [
    "Source : vidéo TikTok. La recette peut être dans la légende, dite à l'oral (transcription automatique, possibles fautes), ou les deux : combine-les. Ignore les hashtags, mentions et appels à s'abonner.",
  ];
  if (caption) parts.push(`Légende${oembed?.author_name ? ` (@${oembed.author_name})` : ""} :\n${caption}`);
  if (transcript) parts.push(`Transcription de la vidéo :\n${transcript}`);

  const images = [oembed?.thumbnail_url, ...(page?.covers ?? [])].filter(
    (u): u is string => typeof u === "string" && u.startsWith("http"),
  );

  console.info(
    `[tiktok] ${id ?? videoUrl} — légende ${caption.length} car., transcription ${transcript.length} car. (${sub?.lang || "aucune"})`,
  );
  return { ok: true, text: parts.join("\n\n"), images: [...new Set(images)], sourceUrl: videoUrl };
}
