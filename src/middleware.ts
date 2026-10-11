import { NextResponse, type NextRequest } from "next/server";

/**
 * Garde-fou d'accès partagé (SANS comptes) : un seul code commun.
 * - Activé uniquement si la variable d'env `ACCESS_CODE` est définie.
 * - Le code correct pose un cookie (mémorisé 1 an) ; le middleware le vérifie.
 * - Pas de code défini → aucune protection (comportement d'origine).
 */

const COOKIE = "klarte_access";

export function middleware(req: NextRequest) {
  const code = process.env.ACCESS_CODE;
  if (!code) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Toujours accessible : assets PWA + page/route du code d'accès.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/favicon.ico" ||
    pathname === "/acces" ||
    pathname === "/api/acces" ||
    pathname === "/api/share" // vérifie lui-même le code (en-tête x-access-code du Raccourci iOS)
  ) {
    return NextResponse.next();
  }

  if (req.cookies.get(COOKIE)?.value === code) {
    return NextResponse.next();
  }

  // API → 401 ; pages → redirection vers l'écran de code.
  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/acces";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
