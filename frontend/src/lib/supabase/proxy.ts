import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEV_SESSION_COOKIE, isDevSessionValue } from "@/lib/dev-auth";

/** Paths reachable without a session. */
const PUBLIC_PREFIXES = ["/login", "/auth"];

export async function updateSession(request: NextRequest) {
  // Dev-only test session; constant-false in a production build. Short-circuits
  // before the Supabase round-trip, which would otherwise find no session and
  // bounce every page back to /login. See dev-auth.ts.
  if (isDevSessionValue(request.cookies.get(DEV_SESSION_COOKIE)?.value)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Responses carrying auth cookies must never be cached by a CDN.
          for (const [key, headerValue] of Object.entries(headers)) {
            response.headers.set(key, headerValue);
          }
        },
      },
    },
  );

  // getUser() revalidates the token with Supabase; getSession() would trust
  // whatever is in the cookie. Do not replace it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
