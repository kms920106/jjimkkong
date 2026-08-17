import { NextResponse, type NextRequest } from "next/server";
import { getProvider, toAuthProvider } from "@/lib/auth/providers";
import { exchangeCodeForToken, fetchProviderProfile } from "@/lib/auth/oauth";
import { linkProviderIdentity } from "@/lib/auth/link";
import {
  createSession,
  destroySession,
  SESSION_COOKIE,
  setSessionCookie,
} from "@/lib/auth/session";
import {
  clearPendingCookie,
  clearStateCookie,
  OAUTH_STATE_COOKIE,
  sealPending,
  setPendingCookie,
  stateMatches,
} from "@/lib/auth/pending";
import { callbackUrl } from "@/lib/auth/urls";

/**
 * Finishes a social login.
 *
 * Two possible endings: a session cookie and a redirect home, or — when the
 * provider withheld the phone number we identify people by — a pending-login
 * cookie and a redirect to the verification step. No session is issued on the
 * second path, so an unverified pending login can do nothing.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: slug } = await params;
  const origin = request.nextUrl.origin;

  // The state is spent the moment the callback is reached, however it ends —
  // leaving it set would turn a one-shot CSRF token into one that stays
  // replayable for the rest of its TTL across retries.
  const fail = (reason: string) => {
    const response = NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(reason)}`,
    );
    clearStateCookie(response);
    clearPendingCookie(response);
    return response;
  };

  const provider = toAuthProvider(slug);
  if (!provider) return fail("unsupported_provider");

  const { searchParams } = request.nextUrl;

  // The user declined the consent screen, or the provider rejected the request.
  const providerError = searchParams.get("error");
  if (providerError) {
    return fail(providerError === "access_denied" ? "access_denied" : "provider_error");
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code) return fail("missing_code");

  // CSRF: without this an attacker can complete the flow with their own code
  // and silently sign the victim's browser into the attacker's account.
  if (!stateMatches(state, request.cookies.get(OAUTH_STATE_COOKIE)?.value)) {
    return fail("state_mismatch");
  }

  try {
    const config = getProvider(provider);
    const accessToken = await exchangeCodeForToken(config, {
      code,
      state: state ?? "",
      redirectUri: callbackUrl(request, slug),
    });
    const profile = await fetchProviderProfile(config, accessToken);
    const outcome = await linkProviderIdentity(provider, profile);

    if (outcome.status === "pendingPhone") {
      const { value, binding } = sealPending(provider, profile);
      const response = NextResponse.redirect(`${origin}/login/verify`);
      setPendingCookie(response, value, binding);
      clearStateCookie(response);
      return response;
    }

    // Rotate: a session already in this browser must not survive the login.
    // Otherwise an attacker who plants their own valid cookie keeps a live
    // session in the victim's browser for its full 30-day TTL.
    await destroySession(request.cookies.get(SESSION_COOKIE)?.value);

    const cookie = await createSession(outcome.user.id, {
      userAgent: request.headers.get("user-agent"),
    });
    const response = NextResponse.redirect(`${origin}/`);
    setSessionCookie(response, cookie);
    clearStateCookie(response);
    return response;
  } catch (error) {
    console.error(`OAuth callback failed for ${slug}:`, error);
    return fail("login_failed");
  }
}
