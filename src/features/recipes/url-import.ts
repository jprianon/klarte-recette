import { formatNote } from "./ai-provider";
import type { RecipeDraft } from "@/types";

/**
 * Import d'une recette depuis un lien (côté serveur uniquement) : récupère la
 * page, en extrait la recette (JSON-LD schema.org/Recipe en priorité, sinon
 * légende og: ou texte nettoyé), puis la met en fiche via l'IA.
 * Partagé par /api/recipes/url (aperçu dans l'app) et /api/share (partage iOS).
 */

const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1";
// Instagram/Facebook ne servent les balises og: (dont la légende) qu'au crawler
// d'aperçu de liens. On se présente comme lui pour récupérer la recette.
const FB_CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

/** User-agent adapté au site : crawler FB pour Insta/Facebook, Safari sinon. */
function userAgentFor(host: string): string {
  return /(^|\.)(instagram\.com|facebook\.com|fb\.watch)$/i.test(host) ? FB_CRAWLER_UA : SAFARI_UA;
}

async function fetchWithTimeout(url: string, ms: number, ua: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        // Certains sites renvoient une page vide sans user-agent « navigateur ».
        "user-agent": ua,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "fr,en;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Décode les entités HTML les plus courantes. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** HTML → texte lisible (retire script/style/nav, aplatit les balises). */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

type JsonLdRecipe = {
  name?: string;
  recipeYield?: unknown;
  totalTime?: string;
  recipeIngredient?: unknown;
  ingredients?: unknown;
  recipeInstructions?: unknown;
  image?: unknown;
};

/** Cherche un objet @type Recipe dans un JSON-LD (gère @graph et les tableaux). */
function findRecipe(node: unknown): JsonLdRecipe | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n);
      if (r) return r;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const isRecipe = Array.isArray(type)
    ? type.some((t) => String(t).toLowerCase() === "recipe")
    : String(type ?? "").toLowerCase() === "recipe";
  if (isRecipe) return obj as JsonLdRecipe;
  if (obj["@graph"]) return findRecipe(obj["@graph"]);
  return null;
}

/** Objet Recipe JSON-LD → texte structuré donné à l'IA. */
function recipeToText(r: JsonLdRecipe): string {
  const lines: string[] = [];
  if (r.name) lines.push(String(r.name));
  if (r.recipeYield) lines.push(`Pour : ${String(r.recipeYield)}`);
  if (r.totalTime) lines.push(`Durée : ${String(r.totalTime)}`);

  const ings = r.recipeIngredient ?? r.ingredients;
  if (Array.isArray(ings) && ings.length) {
    lines.push("Ingrédients :");
    for (const i of ings) lines.push(`- ${String(i)}`);
  }

  const steps = r.recipeInstructions;
  const stepTexts: string[] = [];
  if (typeof steps === "string") stepTexts.push(steps);
  else if (Array.isArray(steps)) {
    for (const s of steps) {
      if (typeof s === "string") stepTexts.push(s);
      else if (s && typeof s === "object" && "text" in s)
        stepTexts.push(String((s as { text: unknown }).text));
    }
  }
  if (stepTexts.length) {
    lines.push("Préparation :");
    for (const s of stepTexts) lines.push(s);
  }
  return lines.join("\n");
}

/** Choisit une URL d'image dans un champ JSON-LD `image` (string/array/objet). */
function pickImage(img: unknown): string | null {
  if (!img) return null;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) {
    for (const i of img) {
      const u = pickImage(i);
      if (u) return u;
    }
    return null;
  }
  if (typeof img === "object" && "url" in (img as object)) {
    return pickImage((img as { url: unknown }).url);
  }
  return null;
}

/** Contenu de la 1ʳᵉ balise <meta> correspondant à l'un des noms (property/name). */
function metaContent(html: string, keys: string[]): string | null {
  const alt = keys.join("|");
  const res = [
    new RegExp(`<meta[^>]+(?:property|name)=["'](?:${alt})["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["'](?:${alt})["']`, "i"),
  ];
  for (const re of res) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return null;
}

/**
 * Légende / description d'un post (Instagram, TikTok, blogs sans JSON-LD) via
 * les balises og:. La recette y est souvent en entier. On retire le préfixe
 * Instagram « 12 K likes, 34 comments - user on date : "…" » pour ne garder que
 * le texte de la légende.
 */
function captionText(html: string): string {
  const title = metaContent(html, ["og:title", "twitter:title"]) ?? "";
  let desc = metaContent(html, ["og:description", "twitter:description", "description"]) ?? "";
  const quoted = desc.match(/:\s*["“«'](.+)["”»']\s*$/s);
  if (quoted?.[1]) desc = quoted[1].trim();
  return [title, desc].filter(Boolean).join("\n").trim();
}

/** Image de repli via les métas Open Graph / Twitter. */
function metaImage(html: string): string | null {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Extrait la recette d'une page : JSON-LD d'abord (texte + image), sinon texte
 * brut nettoyé et image Open Graph. Les URLs relatives sont résolues.
 */
function extractRecipe(html: string, pageUrl: string): { text: string; imageUrl: string | null } {
  let text = "";
  let imageUrl: string | null = null;

  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of scripts) {
    try {
      const recipe = findRecipe(JSON.parse(m[1]!.trim()));
      if (recipe) {
        const t = recipeToText(recipe);
        if (t.trim().length >= 30) {
          text = t;
          imageUrl = pickImage(recipe.image);
          break;
        }
      }
    } catch {
      /* JSON-LD mal formé : on continue */
    }
  }

  // Pas de JSON-LD : la légende og: (Insta/TikTok/blogs) est bien plus pertinente
  // que le texte brut de la page ; on ne se rabat sur ce dernier qu'en dernier ressort.
  if (!text) {
    const caption = captionText(html);
    text = caption.length >= 30 ? caption : htmlToText(html).slice(0, 8000);
  }
  if (!imageUrl) imageUrl = metaImage(html);

  // Résout les URLs relatives contre la page source.
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, pageUrl).href;
    } catch {
      imageUrl = null;
    }
  }
  return { text, imageUrl };
}

// ── Pinterest ────────────────────────────────────────────────────────────────
// Un pin renvoie le plus souvent vers la vraie recette (un blog) : on suit ce
// lien source. Sans source (pin vidéo / « idée »), on garde la description et
// la photo du pin lui-même.

const PINTEREST_HOST = /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/i;
const PINTEREST_OWN = /(^|\.)(pinterest\.[a-z.]+|pin\.it|pinimg\.com)$/i;

export function isPinterest(host: string): boolean {
  return PINTEREST_HOST.test(host);
}

/** Décode une chaîne échappée façon JSON (\/ et \u002F…). */
function unescapeJson(s: string): string {
  return s
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/");
}

/** Lien externe (le site de la recette) d'une page de pin, ou null. */
export function pinterestSourceUrl(html: string): string | null {
  const candidates: string[] = [];
  const meta = metaContent(html, ["pinterestapp:source", "og:see_also"]);
  if (meta) candidates.push(meta);
  // Données de la page (JSON embarqué) : "link":"https://…" / "tracked_link".
  for (const m of html.matchAll(/"(?:link|tracked_link)"\s*:\s*"(https?:[^"]+)"/g)) {
    candidates.push(unescapeJson(m[1]!));
  }
  for (const c of candidates) {
    try {
      const u = new URL(decodeEntities(c));
      if (/^https?:$/.test(u.protocol) && !PINTEREST_OWN.test(u.hostname)) return u.href;
    } catch {
      /* candidat invalide */
    }
  }
  return null;
}

// ── Récupération de pages / images ───────────────────────────────────────────

async function fetchHtml(
  url: string,
): Promise<{ html: string; finalUrl: string } | { status: number }> {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* url déjà validée */
  }
  try {
    const res = await fetchWithTimeout(url, 20_000, userAgentFor(host));
    if (!res.ok) return { status: res.status };
    return { html: await res.text(), finalUrl: res.url || url };
  } catch {
    return { status: 0 };
  }
}

/** Récupère une image distante (photo de la recette). */
export async function fetchRemoteImage(
  url: string,
): Promise<{ contentType: string; buf: Buffer } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0", accept: "image/*" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 10_000_000) return null;
    return { contentType: ct.split(";")[0]!.trim(), buf };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Point d'entrée ───────────────────────────────────────────────────────────

export type UrlImportResult =
  | { ok: true; draft: RecipeDraft; imageUrl: string | null; sourceUrl: string }
  | { ok: false; status: number; error: string; message: string };

export async function importRecipeFromUrl(url: string): Promise<UrlImportResult> {
  const page = await fetchHtml(url);
  if (!("html" in page)) {
    return page.status
      ? {
          ok: false,
          status: 502,
          error: "fetch_failed",
          message: `Page inaccessible (${page.status}).`,
        }
      : {
          ok: false,
          status: 502,
          error: "unreachable",
          message: "Impossible de récupérer la page.",
        };
  }

  let sourceUrl = page.finalUrl;
  let { text, imageUrl } = extractRecipe(page.html, page.finalUrl);

  // Pin Pinterest → on suit le lien vers le site de la recette. La photo du pin
  // sert de repli si la page source n'en fournit pas.
  let host = "";
  try {
    host = new URL(page.finalUrl).hostname;
  } catch {
    /* ignore */
  }
  if (isPinterest(host)) {
    const pinImage = imageUrl;
    const source = pinterestSourceUrl(page.html);
    if (source) {
      const src = await fetchHtml(source);
      if ("html" in src) {
        const extracted = extractRecipe(src.html, src.finalUrl);
        if (extracted.text.trim().length >= 30) {
          text = extracted.text;
          imageUrl = extracted.imageUrl ?? pinImage;
          sourceUrl = src.finalUrl;
        }
      }
    }
  }

  if (text.trim().length < 30) {
    return {
      ok: false,
      status: 422,
      error: "empty_text",
      message:
        "Aucune recette lisible sur ce lien. Astuce : copie la légende du post et colle-la dans « Générateur de recette ».",
    };
  }

  const result = await formatNote(text);
  if (!result.ok) return result;
  return { ok: true, draft: result.draft, imageUrl, sourceUrl };
}
