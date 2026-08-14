import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Page navigations only. `/api` is deliberately excluded: every route
     * handler already calls requireUser(), so running the proxy there would
     * add a second Supabase round-trip per request — and its redirect branch
     * would answer an expired-session fetch() with a 307 to /login whose HTML
     * body then fails res.json(), instead of the 401 the client expects.
     * Static assets and crawler files are excluded for the same latency
     * reason; a logged-out crawler must not be redirected to /login.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
