import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/** Paths reachable without a session. */
const PUBLIC_PREFIXES = ["/login"];

/**
 * Bounces logged-out page navigations to /login.
 *
 * Only the cookie's *presence* is checked here, not its validity: the proxy
 * runs on the Edge runtime, where the database client and node:crypto that
 * resolveSession() needs are unavailable. That is safe because this is a
 * redirect for the user's benefit, not an authorization gate — every route
 * handler and page still calls requireUser(), which does verify the session
 * against the database. A forged cookie gets past this and straight into a
 * 401.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (isPublic) return NextResponse.next();

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Page navigations only. `/api` is deliberately excluded: every route
     * handler already calls requireUser(), and this file's redirect branch
     * would answer an expired-session fetch() with a 307 to /login whose HTML
     * body then fails res.json(), instead of the 401 the client expects.
     * `/api/auth` in particular must never be redirected — it is how a
     * logged-out user signs in. Static assets and crawler files are excluded
     * for latency; a logged-out crawler must not be redirected to /login.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
