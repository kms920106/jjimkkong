import type { NextRequest } from "next/server";
import { OAuthConfigError } from "./providers";

/**
 * The callback URL sent to the provider.
 *
 * This string has to match what is registered in the provider's console
 * character for character, or the handshake fails with an opaque error. It
 * also has to match between the authorize request and the token exchange —
 * providers compare the two.
 *
 * `AUTH_BASE_URL` exists because `request.nextUrl.origin` is the *incoming*
 * origin, which behind Vercel's proxy can be the internal deployment URL
 * rather than the public domain the callback was registered under. Set it in
 * production; locally the request origin is already right.
 */
export function baseUrl(request: NextRequest): string {
  const configured = process.env.AUTH_BASE_URL?.replace(/\/$/, "");
  if (configured) return configured;

  // Falling back to the request origin means trusting the Host header, which
  // the caller controls. That is fine locally and unacceptable in production,
  // where it would put an attacker-influenced host into the redirect_uri we
  // send to the provider. Fail loudly at deploy time instead.
  if (process.env.NODE_ENV === "production") {
    throw new OAuthConfigError("AUTH_BASE_URL이 프로덕션에 설정되지 않았습니다.");
  }
  return request.nextUrl.origin;
}

export function callbackUrl(request: NextRequest, slug: string): string {
  return `${baseUrl(request)}/api/auth/${slug}/callback`;
}
