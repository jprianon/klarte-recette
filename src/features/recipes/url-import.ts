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

/** Entités nommées courantes (accents français, ponctuation typographique). */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  Eacute: "É",
  Egrave: "È",
  Ecirc: "Ê",
  agrave: "à",
  acirc: "â",
  auml: "ä",
  Agrave: "À",
  Acirc: "Â",
  icirc: "î",
  iuml: "ï",
  ocirc: "ô",
  ouml: "ö",
  Ocirc: "Ô",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  ccedil: "ç",
  Ccedil: "Ç",
  oelig: "œ",
  OElig: "Œ",
  aelig: "æ",
  deg: "°",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  times: "×",
  middot: "·",
};

function codePoint(n: number, raw: string): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
}

/** Décode les entités HTML : nommées, décimales (&#233;) et hexadécimales (&#xe9;). */
export function decodeEntities(s: string): string {
  // Deux passes : certains sites double-encodent (« &amp;#xe9; »).
  for (let i = 0; i < 2; i++) {
    s = s
      .replace(/&#x([0-9a-f]+);/gi, (raw, h) => codePoint(parseInt(h, 16), raw))
      .replace(/&#(\d+);/g, (raw, n) => codePoint(Number(n), raw))
      .replace(/&([a-z][a-z0-9]*);/gi, (raw, name) => NAMED_ENTITIES[name] ?? raw);
  }
  return s;
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
  // Les champs JSON-LD contiennent souvent des entités HTML (« Po&#xea;l&#xe9;e »).
  return decodeEntities(lines.join("\n"));
}

/**
 * URLs d'images d'un champ JSON-LD `image` (string / tableau / ImageObject).
 * Les références `{"@id": …}` (Yoast/WordPress) sont résolues via `byId`.
 */
function collectImages(img: unknown, byId: Map<string, unknown>, out: string[], depth = 0): void {
  if (!img || depth > 4) return;
  if (typeof img === "string") {
    out.push(img);
    return;
  }
  if (Array.isArray(img)) {
    for (const i of img) collectImages(i, byId, out, depth + 1);
    return;
  }
  if (typeof img === "object") {
    const o = img as Record<string, unknown>;
    for (const k of ["url", "contentUrl", "thumbnailUrl"]) {
      if (typeof o[k] === "string") out.push(o[k] as string);
    }
    const ref = typeof o["@id"] === "string" ? byId.get(o["@id"] as string) : undefined;
    if (ref && ref !== img) collectImages(ref, byId, out, depth + 1);
  }
}

/** Index des nœuds JSON-LD par @id (pour résoudre les références d'image). */
function indexById(node: unknown, map: Map<string, unknown>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) indexById(n, map);
    return;
  }
  const o = node as Record<string, unknown>;
  if (typeof o["@id"] === "string" && Object.keys(o).length > 1) map.set(o["@id"] as string, o);
  if (o["@graph"]) indexById(o["@graph"], map);
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

/** Images des métas Open Graph / Twitter (entités HTML décodées). */
function metaImages(html: string): string[] {
  const out: string[] = [];
  const keys = "og:image|og:image:secure_url|og:image:url|twitter:image|twitter:image:src";
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["'](?:${keys})["'][^>]+content=["']([^"']+)["']`,
      "gi",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:${keys})["']`,
      "gi",
    ),
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) out.push(decodeEntities(m[1]!));
  }
  return out;
}

/** Résout, filtre (http/https, pas de data:) et dédoublonne une liste d'URLs d'images. */
function cleanImageUrls(urls: string[], pageUrl: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    try {
      const u = new URL(decodeEntities(raw.trim()), pageUrl);
      if (!/^https?:$/.test(u.protocol) || seen.has(u.href)) continue;
      seen.add(u.href);
      out.push(u.href);
    } catch {
      /* URL invalide */
    }
  }
  return out;
}

/**
 * Extrait la recette d'une page : JSON-LD d'abord (texte + images), sinon
 * légende og: ou texte brut. `images` = photos candidates, de la plus
 * pertinente à la moins pertinente (JSON-LD, puis Open Graph / Twitter).
 */
function extractRecipe(html: string, pageUrl: string): { text: string; images: string[] } {
  let text = "";
  const found: string[] = [];

  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of scripts) {
    try {
      const json: unknown = JSON.parse(m[1]!.trim());
      const recipe = findRecipe(json);
      if (recipe) {
        const t = recipeToText(recipe);
        if (t.trim().length >= 30) {
          text = t;
          const byId = new Map<string, unknown>();
          indexById(json, byId);
          collectImages(recipe.image, byId, found);
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
  found.push(...metaImages(html));
  return { text, images: cleanImageUrls(found, pageUrl) };
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

/** Photos du pin en grand format (i.pinimg.com), trouvées dans la page. */
export function pinterestImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(
    /https?:(?:\\?\/){2}i\.pinimg\.com(?:\\?\/)(?:originals|736x|564x)(?:\\?\/)[^"'\s<>\\]+?\.(?:jpe?g|png|webp)/gi,
  )) {
    out.push(unescapeJson(m[0]));
  }
  // originals d'abord, puis les tailles réduites
  return out.sort((a, b) => Number(b.includes("/originals/")) - Number(a.includes("/originals/")));
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

/** Type d'image d'après les premiers octets (certains CDN renvoient octet-stream). */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (brand.startsWith("avi")) return "image/avif";
    if (brand.startsWith("hei") || brand === "mif1") return "image/heic";
  }
  return null;
}

/**
 * Récupère une image distante (photo de la recette). On se présente comme
 * Safari et avec la page d'origine en Referer : beaucoup de blogs / CDN
 * refusent sinon (protection anti-hotlink).
 */
export async function fetchRemoteImage(
  url: string,
  referer?: string,
): Promise<{ contentType: string; buf: Buffer } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const headers: Record<string, string> = {
      "user-agent": SAFARI_UA,
      accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
      "accept-language": "fr,en;q=0.8",
    };
    if (referer) headers.referer = referer;
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 10_000_000) return null;
    const declared = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    const contentType = declared.startsWith("image/") ? declared : sniffImageType(buf);
    return contentType ? { contentType, buf } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Essaie les photos candidates dans l'ordre et renvoie la première qui se
 * télécharge (avec puis sans Referer). Journalise les échecs pour le debug.
 */
export async function fetchFirstImage(
  candidates: string[],
  referer?: string,
): Promise<{ contentType: string; buf: Buffer; url: string } | null> {
  for (const url of candidates.slice(0, 6)) {
    const img =
      (await fetchRemoteImage(url, referer)) ?? (referer ? await fetchRemoteImage(url) : null);
    if (img) return { ...img, url };
    console.warn("[url-import] photo non récupérée :", url);
  }
  if (!candidates.length)
    console.warn("[url-import] aucune photo trouvée sur la page", referer ?? "");
  return null;
}

// ── Point d'entrée ───────────────────────────────────────────────────────────

export type UrlImportResult =
  | {
      ok: true;
      draft: RecipeDraft;
      /** Meilleure photo candidate (compatibilité : 1ʳᵉ de `imageUrls`). */
      imageUrl: string | null;
      /** Photos candidates, de la plus pertinente à la moins pertinente. */
      imageUrls: string[];
      sourceUrl: string;
    }
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
  let { text, images } = extractRecipe(page.html, page.finalUrl);

  // Pin Pinterest → on suit le lien vers le site de la recette. Les photos du
  // pin restent en repli derrière celles de la page source.
  let host = "";
  try {
    host = new URL(page.finalUrl).hostname;
  } catch {
    /* ignore */
  }
  if (isPinterest(host)) {
    const pinImages = cleanImageUrls([...images, ...pinterestImages(page.html)], page.finalUrl);
    images = pinImages;
    const source = pinterestSourceUrl(page.html);
    if (source) {
      const src = await fetchHtml(source);
      if ("html" in src) {
        const extracted = extractRecipe(src.html, src.finalUrl);
        if (extracted.text.trim().length >= 30) {
          text = extracted.text;
          sourceUrl = src.finalUrl;
        }
        images = cleanImageUrls([...extracted.images, ...pinImages], src.finalUrl);
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
  return {
    ok: true,
    draft: result.draft,
    imageUrl: images[0] ?? null,
    imageUrls: images,
    sourceUrl,
  };
}
