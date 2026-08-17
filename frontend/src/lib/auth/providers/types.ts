import type { AuthProvider } from "@/generated/prisma/enums";

/** What a provider tells us about the person who just signed in. */
export type ProviderProfile = {
  /** The provider's immutable id for this user. Never an email. */
  providerUserId: string;
  email: string | null;
  /**
   * As the provider gave it, in whatever format they use. Normalized to E.164
   * by the caller — providers are wildly inconsistent here (Naver returns
   * `010-1234-5678`, Kakao returns `+82 10-1234-5678`).
   */
  phone: string | null;
  /**
   * Whether the provider carrier-verified that number, rather than letting the
   * user type whatever they liked into a profile field.
   *
   * This is the difference between a convenience and an account takeover: the
   * phone is the key accounts merge on, so an unverified number would let
   * anyone who can set a profile field at a sloppy provider walk into the
   * matching account here. Default it to `false` for every provider added
   * later and only set it where the guarantee is documented.
   */
  phoneVerified: boolean;
  name: string | null;
};

/**
 * Everything provider-specific about an OAuth 2.0 authorization-code login.
 * Adding Kakao or Apple means adding one of these and a value to the
 * AuthProvider enum — the routes, session handling, and account linking are
 * already shared.
 */
export type OAuthProviderConfig = {
  id: AuthProvider;
  /** Shown in error messages. */
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  clientId: string;
  clientSecret: string;
  /** Space-separated, or null when the provider has no scope parameter. */
  scope: string | null;
  /**
   * Extra parameters for the authorize redirect. Apple needs
   * `response_mode=form_post` here once it lands.
   */
  extraAuthorizeParams?: Record<string, string>;
  /** Maps the provider's profile response onto the shared shape. */
  parseProfile: (raw: unknown) => ProviderProfile;
};

/** Thrown when a provider's env vars are missing, or it returns a bad response. */
export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthConfigError";
  }
}

/** Thrown when the user-facing OAuth handshake fails (bad state, denied, etc). */
export class OAuthFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthFlowError";
  }
}
