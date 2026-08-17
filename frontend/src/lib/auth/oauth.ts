import {
  OAuthConfigError,
  OAuthFlowError,
  type OAuthProviderConfig,
  type ProviderProfile,
} from "./providers";

/** Providers occasionally hang; without this the route holds a worker open. */
const TIMEOUT_MS = 10_000;

/** Builds the URL the browser is redirected to in order to start the login. */
export function buildAuthorizeUrl(
  provider: OAuthProviderConfig,
  { redirectUri, state }: { redirectUri: string; state: string },
): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  if (provider.scope) url.searchParams.set("scope", provider.scope);
  for (const [key, value] of Object.entries(provider.extraAuthorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

const TokenErrorKeys = ["error", "error_description"] as const;

/**
 * Trades the authorization code for an access token.
 *
 * Sent as a POST form body even though Naver also accepts GET: the code and
 * the client secret would otherwise land in the provider's access logs and in
 * any proxy between here and them.
 */
export async function exchangeCodeForToken(
  provider: OAuthProviderConfig,
  { code, state, redirectUri }: { code: string; state: string; redirectUri: string },
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    state,
    redirect_uri: redirectUri,
  });

  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new OAuthFlowError(
      `${provider.label} 토큰 발급에 실패했습니다. (HTTP ${response.status})`,
    );
  }

  // Naver answers a rejected code with HTTP 200 and an `error` field, so the
  // status above is not enough on its own.
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null) {
    throw new OAuthFlowError(`${provider.label} 토큰 응답을 해석할 수 없습니다.`);
  }

  const record = payload as Record<string, unknown>;
  for (const key of TokenErrorKeys) {
    if (typeof record[key] === "string" && record[key]) {
      throw new OAuthFlowError(
        `${provider.label} 토큰 발급에 실패했습니다. (${String(record.error_description ?? record.error)})`,
      );
    }
  }

  const accessToken = record.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new OAuthFlowError(`${provider.label} 토큰 응답에 access_token이 없습니다.`);
  }
  return accessToken;
}

/** Fetches the signed-in user's profile with the access token. */
export async function fetchProviderProfile(
  provider: OAuthProviderConfig,
  accessToken: string,
): Promise<ProviderProfile> {
  const response = await fetch(provider.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new OAuthFlowError(
      `${provider.label} 프로필 조회에 실패했습니다. (HTTP ${response.status})`,
    );
  }

  const payload: unknown = await response.json();
  try {
    return provider.parseProfile(payload);
  } catch (cause) {
    if (cause instanceof OAuthConfigError) throw cause;
    throw new OAuthFlowError(`${provider.label} 프로필 응답을 해석할 수 없습니다.`);
  }
}
