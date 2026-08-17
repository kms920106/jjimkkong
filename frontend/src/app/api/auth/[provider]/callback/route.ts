import { NextResponse, type NextRequest } from "next/server";
import {
  getProvider,
  OAuthConfigError,
  toAuthProvider,
} from "@/lib/auth/providers";
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
  clearReturnToCookie,
  clearStateCookie,
  OAUTH_STATE_COOKIE,
  RETURN_TO_COOKIE,
  safeReturnPath,
  sealPending,
  setPendingCookie,
  stateMatches,
} from "@/lib/auth/pending";
import { callbackUrl } from "@/lib/auth/urls";

/**
 * Finishes a social login.
 *
 * Two possible endings: a session cookie and a redirect home for a returning
 * user, or — for every first sign-in with this provider account — a
 * pending-login cookie and a redirect to the SMS step. No session is issued on
 * the second path, so an unverified pending login can do nothing.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: slug } = await params;
  const origin = request.nextUrl.origin;
  // Set by the start route from the page the login drawer was opened on.
  const returnTo = safeReturnPath(request.cookies.get(RETURN_TO_COOKIE)?.value);

  /**
   * Sends the user back where they started with the reason attached, since
   * there is no login page to land on. `?auth=login` reopens the drawer so the
   * message is shown in the place the attempt was made.
   *
   * The state is spent the moment the callback is reached, however it ends —
   * leaving it set would turn a one-shot CSRF token into one that stays
   * replayable for the rest of its TTL across retries.
   */
  const fail = (reason: string) => {
    const url = new URL(returnTo, origin);
    url.searchParams.set("auth", "login");
    url.searchParams.set("error", reason);
    const response = NextResponse.redirect(url.toString());
    clearStateCookie(response);
    clearPendingCookie(response);
    clearReturnToCookie(response);
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
      // To the verification page, which gates on the pending cookie set here.
      // The return-to cookie is deliberately left in place: that page reads it
      // to send the user back where the login started once the code checks out.
      const { value, binding } = sealPending(provider, profile);
      const response = NextResponse.redirect(`${origin}/verify-phone`);
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
    const response = NextResponse.redirect(new URL(returnTo, origin).toString());
    setSessionCookie(response, cookie);
    clearStateCookie(response);
    clearReturnToCookie(response);
    return response;
  } catch (error) {
    console.error(`OAuth callback failed for ${slug}:`, error);
    // Distinguished so a missing env var does not read to the operator as a
    // user's login failing — the two need opposite responses.
    return fail(
      error instanceof OAuthConfigError ? "provider_unavailable" : "login_failed",
    );
  }
}
