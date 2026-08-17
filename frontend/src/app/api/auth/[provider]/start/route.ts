import { NextResponse, type NextRequest } from "next/server";
import { getProvider, toAuthProvider } from "@/lib/auth/providers";
import { buildAuthorizeUrl } from "@/lib/auth/oauth";
import { createOAuthState, setStateCookie } from "@/lib/auth/pending";
import { callbackUrl } from "@/lib/auth/urls";

/**
 * Starts a social login: mints a CSRF state, stores it in a cookie, and sends
 * the browser to the provider.
 *
 * A GET so the login page can be a plain link, and a redirect rather than a
 * JSON payload so the flow works without JavaScript.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: slug } = await params;
  const origin = request.nextUrl.origin;

  const provider = toAuthProvider(slug);
  if (!provider) {
    return NextResponse.redirect(`${origin}/login?error=unsupported_provider`);
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
    return response;
  } catch (error) {
    console.error(`OAuth start failed for ${slug}:`, error);
    return NextResponse.redirect(`${origin}/login?error=provider_unavailable`);
  }
}
