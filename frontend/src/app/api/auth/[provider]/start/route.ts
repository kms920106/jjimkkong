import { NextResponse, type NextRequest } from "next/server";
import { getProvider, toAuthProvider } from "@/lib/auth/providers";
import { buildAuthorizeUrl } from "@/lib/auth/oauth";
import {
  createOAuthState,
  safeReturnPath,
  setReturnToCookie,
  setStateCookie,
} from "@/lib/auth/pending";
import { callbackUrl } from "@/lib/auth/urls";

/**
 * Starts a social login: mints a CSRF state, stores it in a cookie, and sends
 * the browser to the provider.
 *
 * A GET so the login drawer can open this with a plain link, and a redirect
 * rather than a JSON payload so the flow works without JavaScript.
 *
 * `?next=` is the page the drawer was opened from. It is stashed in a cookie
 * because the provider handshake navigates away and comes back to a URL we do
 * not control the query string of.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: slug } = await params;
  const origin = request.nextUrl.origin;
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("next"));

  /**
   * Failures land back on the page the user started from, with the reason as a
   * query param the login drawer reads and reopens itself to show. There is no
   * dedicated login page to fall back on.
   */
  const failUrl = (reason: string) => {
    const url = new URL(returnTo, origin);
    url.searchParams.set("auth", "login");
    url.searchParams.set("error", reason);
    return url.toString();
  };

  const provider = toAuthProvider(slug);
  if (!provider) {
    return NextResponse.redirect(failUrl("unsupported_provider"));
  }

  try {
    const config = getProvider(provider);
    const state = createOAuthState();

    const response = NextResponse.redirect(
      buildAuthorizeUrl(config, {
        redirectUri: callbackUrl(request, slug),
        state,
      }),
    );
    setStateCookie(response, state);
    setReturnToCookie(response, returnTo);
    return response;
  } catch (error) {
    console.error(`OAuth start failed for ${slug}:`, error);
    return NextResponse.redirect(failUrl("provider_unavailable"));
  }
}
