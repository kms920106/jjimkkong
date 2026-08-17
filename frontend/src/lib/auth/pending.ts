import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { z } from "zod";
import { AuthProvider } from "@/generated/prisma/enums";
import type { ProviderProfile } from "./providers";

export const PENDING_COOKIE = "jjimkkong-pending-login";
export const OAUTH_STATE_COOKIE = "jjimkkong-oauth-state";

/**
 * Second half of the pending login, held in its own cookie.
 *
 * The sealed payload names the provider account a session will be issued for,
 * so a signature alone is not enough: an attacker can start their own login,
 * copy the resulting cookie, and plant it in a victim's browser. The victim
 * then verifies their own phone and the attacker's identity gets grafted onto
 * the victim's account. Splitting a random binding value into a separate
 * cookie means possessing the sealed blob is not sufficient — both halves have
 * to be present in the same browser, and an attacker who can set both can
 * already set anything.
 */
export const PENDING_BINDING_COOKIE = "jjimkkong-pending-binding";

/** Long enough to read an SMS, short enough that a stale tab cannot resume. */
const PENDING_TTL_MS = 1000 * 60 * 10;

/**
 * A sign-in that authenticated with the provider but has no session yet,
 * because the provider gave us no phone number to identify the person by.
 *
 * Held in a signed cookie rather than a table: it is short-lived, single-user,
 * and losing it on a cookie clear should just mean starting over. The
 * signature is what makes it safe — the payload names the provider account a
 * session will be issued for, so an unsigned cookie would be a login form
 * where you type whichever account you want.
 */
const PendingSchema = z.object({
  provider: z.enum(AuthProvider),
  profile: z.object({
    providerUserId: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    // Carried through but not trusted on the way out: completeIdentityLink
    // uses the number the user proved by SMS, never this one.
    phoneVerified: z.boolean(),
    name: z.string().nullable(),
  }),
  /** Random per pending login; scopes the SMS challenge to this attempt. */
  nonce: z.string(),
  /** HMAC of the binding cookie, tying this payload to one browser. */
  binding: z.string(),
  expiresAt: z.number(),
});

export type PendingLogin = z.infer<typeof PendingSchema>;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "AUTH_SECRET이 설정되지 않았거나 너무 짧습니다. (32자 이상 필요)",
    );
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * Serializes and signs a pending login, returning both cookie values. Both
 * must be set on the response, and both must come back for it to open.
 */
export function sealPending(
  provider: AuthProvider,
  profile: ProviderProfile,
): { value: string; binding: string } {
  const bindingSecret = randomBytes(32).toString("base64url");
  const pending: PendingLogin = {
    provider,
    profile,
    nonce: randomBytes(16).toString("base64url"),
    binding: sign(bindingSecret),
    expiresAt: Date.now() + PENDING_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(pending)).toString("base64url");
  return { value: `${payload}.${sign(payload)}`, binding: bindingSecret };
}

/**
 * Verifies and parses a pending-login cookie, or returns null.
 *
 * `bindingValue` is the companion cookie; the payload only opens when it
 * matches, so a sealed blob transplanted into another browser is inert.
 *
 * Not single-use. Nothing records that a pending login was consumed, so within
 * PENDING_TTL_MS the holder of *both* cookies can present them again. That is
 * bounded rather than prevented: a replayer can only re-link the provider
 * account they already authenticated as, to a number they can receive SMS on.
 * Closing it entirely means a PendingLogin row with a `consumedAt` burned in
 * the same transaction as completeIdentityLink — do that if this cookie ever
 * grows the power to act on an existing account.
 */
export function openPending(
  value: string | undefined,
  bindingValue: string | undefined,
): PendingLogin | null {
  if (!value || !bindingValue) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = value.slice(0, separator);
  const provided = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(sign(payload));
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  try {
    const parsed = PendingSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
    if (parsed.expiresAt <= Date.now()) return null;

    // Both halves must belong together, or this is a transplanted cookie.
    const boundTo = Buffer.from(parsed.binding);
    const presented = Buffer.from(sign(bindingValue));
    if (
      boundTo.length !== presented.length ||
      !timingSafeEqual(boundTo, presented)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/** The SMS challenge's `purpose`, tying a code to one pending login. */
export function pendingPurpose(pending: PendingLogin): string {
  return `login:${pending.provider}:${pending.nonce}`;
}

function shortLivedCookie(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // Lax: both this and the state cookie must survive the top-level
    // cross-site redirect back from the provider.
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Sets both halves of the pending login. */
export function setPendingCookie(
  response: NextResponse,
  value: string,
  binding: string,
): void {
  const options = shortLivedCookie(Math.floor(PENDING_TTL_MS / 1000));
  response.cookies.set(PENDING_COOKIE, value, options);
  response.cookies.set(PENDING_BINDING_COOKIE, binding, options);
}

export function clearPendingCookie(response: NextResponse): void {
  response.cookies.set(PENDING_COOKIE, "", shortLivedCookie(0));
  response.cookies.set(PENDING_BINDING_COOKIE, "", shortLivedCookie(0));
}

/** CSRF token for the authorize redirect, echoed back by the provider. */
export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function setStateCookie(response: NextResponse, state: string): void {
  response.cookies.set(OAUTH_STATE_COOKIE, state, shortLivedCookie(60 * 10));
}

export function clearStateCookie(response: NextResponse): void {
  response.cookies.set(OAUTH_STATE_COOKIE, "", shortLivedCookie(0));
}

/** Constant-time compare of the returned state against the cookie. */
export function stateMatches(
  returned: string | null,
  stored: string | undefined,
): boolean {
  if (!returned || !stored) return false;
  const a = Buffer.from(returned);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
