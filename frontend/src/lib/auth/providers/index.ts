import { AuthProvider } from "@/generated/prisma/enums";
import { naverProvider } from "./naver";
import { OAuthConfigError, type OAuthProviderConfig } from "./types";

/**
 * The providers this build can sign users in with.
 *
 * Factories rather than values: each one throws when its credentials are
 * missing, and building the whole map eagerly would take the app down at
 * import time over a provider nobody enabled. Resolution happens per request.
 *
 * Adding Kakao or Apple is a file in this directory plus a line here — the
 * routes, session handling, and account linking below are already shared.
 */
const FACTORIES: Partial<Record<AuthProvider, () => OAuthProviderConfig>> = {
  [AuthProvider.NAVER]: naverProvider,
};

/** Slug used in `/api/auth/[provider]/…` URLs. */
export type ProviderSlug = "naver" | "kakao" | "apple" | "google";

const SLUGS: Record<ProviderSlug, AuthProvider> = {
  naver: AuthProvider.NAVER,
  kakao: AuthProvider.KAKAO,
  apple: AuthProvider.APPLE,
  google: AuthProvider.GOOGLE,
};

/** Maps a URL slug onto an enum value, or null when it is not a provider. */
export function toAuthProvider(slug: string): AuthProvider | null {
  return SLUGS[slug as ProviderSlug] ?? null;
}

/** Whether this build has credentials configured for a provider. */
export function isProviderEnabled(provider: AuthProvider): boolean {
  const factory = FACTORIES[provider];
  if (!factory) return false;
  try {
    factory();
    return true;
  } catch {
    return false;
  }
}

/** Resolves a provider's config, throwing if it is unsupported or unconfigured. */
export function getProvider(provider: AuthProvider): OAuthProviderConfig {
  const factory = FACTORIES[provider];
  if (!factory) {
    throw new OAuthConfigError(`지원하지 않는 로그인 방식입니다. (${provider})`);
  }
  return factory();
}

export { OAuthConfigError, OAuthFlowError } from "./types";
export type { OAuthProviderConfig, ProviderProfile } from "./types";
