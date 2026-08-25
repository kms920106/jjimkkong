import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { z } from "zod";
import type { LocalMobile } from "./phone";

/**
 * The phone-only sign-in challenge, held in a cookie pair the same way a
 * pending OAuth login is (see pending.ts).
 *
 * It carries no identity — a phone-only sign-in has no provider account to name,
 * and the account it lands on is decided by the number the user proves. What it
 * carries is a nonce, which scopes the SMS challenge to one attempt: sms.ts keys
 * both the code lookup and its per-attempt send budget on `purpose`, so without
 * a per-attempt value there is nothing to scope either to.
 *
 * Be precise about what the send budget is worth here. It holds for a client
 * that keeps its cookie, which covers the honest cases — a stuck retry, a user
 * mistyping their number twice. It does not hold against a client that discards
 * the cookie, because the send route mints a fresh nonce on demand and so hands
 * out a fresh budget. That is the structural difference from pending.ts, whose
 * nonce is minted behind a provider-authenticated callback and therefore costs a
 * full OAuth consent round trip per reset. A public form has no such cost to
 * charge. Abuse across many numbers is consequently bounded by the per-number
 * ceilings in sms.ts and by edge rate limiting, not by this cookie — do not read
 * it as the second axis the root AGENTS.md requires.
 */
export const PHONE_CHALLENGE_COOKIE = "jjimkkong-phone-challenge";

/**
 * The binding half, split out to keep this cookie's shape identical to the
 * pending login's — but be clear that it earns much less here, because the two
 * payloads are not comparable.
 *
 * There, the payload names a provider identity, so a sealed blob planted in a
 * victim's browser grafts the attacker's identity onto the victim's account when
 * the victim verifies their own number. That is account takeover, and the binding
 * is what prevents it. Here the payload names nobody: the session follows the
 * number proven by SMS, which a planted cookie does not change and which the
 * attacker cannot receive. So the binding prevents no takeover on this path.
 *
 * What it leaves is a nonce an attacker could fix in a victim's browser given a
 * cookie-injection primitive, which is a denial-of-service ingredient rather than
 * an escalation. It is kept because the cost is one cookie and the symmetry with
 * pending.ts is worth more than the saving — and because it becomes load-bearing
 * if this cookie ever gains the power to act on an existing account.
 */
export const PHONE_CHALLENGE_BINDING_COOKIE = "jjimkkong-phone-challenge-binding";

/** Long enough to read an SMS and retype a mistyped number, short enough that a stale tab cannot resume. */
const CHALLENGE_TTL_MS = 1000 * 60 * 10;

/**
 * What the challenge is for. Namespaced into the SMS `purpose`, so a code minted
 * to create an account cannot be redeemed to reset an existing one's password, or
 * the reverse — the two have different consequences and must not be
 * interchangeable.
 */
export const PHONE_CHALLENGE_INTENTS = ["signup", "reset"] as const;
export type PhoneChallengeIntent = (typeof PHONE_CHALLENGE_INTENTS)[number];

const ChallengeSchema = z.object({
  /** Random per attempt; scopes the SMS challenge and its send budget. */
  nonce: z.string(),
  /** What completing this challenge is allowed to do. */
  intent: z.enum(PHONE_CHALLENGE_INTENTS),
  /**
   * Set once the SMS code has been redeemed, alongside the number it was proven
   * on. This is what the password routes check: a session must not be issued
   * before a password exists, so the "proven the number, not yet chosen a
   * password" state has to survive between two requests, and this cookie is where
   * it lives. Absent means the code has not been redeemed.
   *
   * The number is carried here rather than re-submitted and trusted, because the
   * password request would otherwise be free to name a different number than the
   * one the code was sent to.
   */
  verifiedPhone: z.string().nullable(),
  /**
   * The PhoneVerification row the proof came from, so the password step can spend
   * it exactly once. Null until the code is redeemed, alongside `verifiedPhone`.
   *
   * An int since 20260825. A cookie minted before that carries a string here and
   * no longer parses — openPhoneChallenge() swallows the ZodError and returns
   * null, which reads as "no proof" and costs the user one more SMS. Bounded by
   * the 10-minute TTL, so the window closes on its own; it is not worth a
   * permanent union type to widen.
   */
  verificationId: z.number().int().nullable(),
  /** HMAC of the binding cookie, tying this payload to one browser. */
  binding: z.string(),
  expiresAt: z.number(),
});

export type PhoneChallenge = z.infer<typeof ChallengeSchema>;

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
 * Mints a challenge, returning the challenge itself alongside both cookie
 * values. Both cookies must be set on the response, and both must come back for
 * it to open again.
 *
 * The parsed `challenge` is handed back so the caller can derive the `purpose`
 * without round-tripping through openPhoneChallenge() — sealing and immediately
 * reopening would only re-verify a signature this function just produced.
 */
export function sealPhoneChallenge(intent: PhoneChallengeIntent): {
  challenge: PhoneChallenge;
  value: string;
  binding: string;
} {
  const bindingSecret = randomBytes(32).toString("base64url");
  const challenge: PhoneChallenge = {
    nonce: randomBytes(16).toString("base64url"),
    intent,
    verifiedPhone: null,
    verificationId: null,
    binding: sign(bindingSecret),
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(challenge)).toString("base64url");
  return {
    challenge,
    value: `${payload}.${sign(payload)}`,
    binding: bindingSecret,
  };
}

/**
 * Verifies and parses a challenge cookie pair, or returns null.
 *
 * Unlike the pending-login cookie, the absence of this one is a normal starting
 * state rather than an expired login: the send route mints it on first use. Null
 * therefore means "start a fresh attempt" on the send path, and "there is no
 * challenge to redeem" on the verify path.
 */
export function openPhoneChallenge(
  value: string | undefined,
  bindingValue: string | undefined,
): PhoneChallenge | null {
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
    const parsed = ChallengeSchema.parse(
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

/**
 * The SMS challenge's `purpose` for a phone-only sign-in.
 *
 * The `phone:` prefix namespaces these away from the OAuth path's
 * `login:<provider>:<nonce>`, so a code minted to finish a Naver sign-in cannot
 * be redeemed to open a phone-only session, or the reverse. verifyPhoneCode
 * matches on `purpose` exactly, so the prefix is what enforces that.
 */
export function phoneLoginPurpose(challenge: PhoneChallenge): string {
  return `phone:${challenge.intent}:${challenge.nonce}`;
}

/**
 * Re-seals a challenge with the proven number recorded, keeping its nonce, intent,
 * binding and expiry.
 *
 * The nonce is kept on purpose: it is what the SMS send budget counts against, so
 * minting a fresh one on each verification would hand the caller a clean budget
 * every time. The expiry is kept for the same reason the send route refuses to
 * re-set an unexpired cookie — sliding it forward here would let one attempt be
 * held open indefinitely by verifying repeatedly.
 *
 * `binding` is the stored HMAC, not the secret, and cannot be reversed — so the
 * original binding cookie value is not needed and is not touched. Only the payload
 * half is rewritten; the binding cookie already in the browser still matches it.
 */
export function sealVerifiedChallenge(
  challenge: PhoneChallenge,
  verifiedPhone: LocalMobile,
  verificationId: number,
): { value: string } {
  const verified: PhoneChallenge = {
    ...challenge,
    verifiedPhone,
    verificationId,
  };
  const payload = Buffer.from(JSON.stringify(verified)).toString("base64url");
  return { value: `${payload}.${sign(payload)}` };
}

function challengeCookie(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // Lax, matching the other auth cookies. No cross-site redirect is involved
    // in this flow, but the value is only ever read by same-origin fetches from
    // the login drawer, so nothing needs more than this.
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Sets both halves of the challenge. */
export function setPhoneChallengeCookie(
  response: NextResponse,
  value: string,
  binding: string,
): void {
  const options = challengeCookie(Math.floor(CHALLENGE_TTL_MS / 1000));
  response.cookies.set(PHONE_CHALLENGE_COOKIE, value, options);
  response.cookies.set(PHONE_CHALLENGE_BINDING_COOKIE, binding, options);
}

/**
 * Rewrites only the payload half, leaving the binding cookie in place.
 *
 * `maxAge` is derived from the challenge's own remaining lifetime rather than
 * reset to the full TTL, so re-sealing cannot extend the attempt past the bound
 * the original mint set.
 */
export function setVerifiedChallengeCookie(
  response: NextResponse,
  challenge: PhoneChallenge,
  value: string,
): void {
  const remainingMs = challenge.expiresAt - Date.now();
  const maxAge = Math.max(1, Math.floor(remainingMs / 1000));
  response.cookies.set(PHONE_CHALLENGE_COOKIE, value, challengeCookie(maxAge));
}

export function clearPhoneChallengeCookie(response: NextResponse): void {
  response.cookies.set(PHONE_CHALLENGE_COOKIE, "", challengeCookie(0));
  response.cookies.set(PHONE_CHALLENGE_BINDING_COOKIE, "", challengeCookie(0));
}
