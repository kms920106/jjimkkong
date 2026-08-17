import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "jjimkkong-session";

/** Matches the Session.expiresAt written at creation. */
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * The cookie is `<sessionId>.<secret>`. The id looks the row up; the secret is
 * compared against its SHA-256. Splitting them means a stolen database dump
 * has no replayable value in it, while still allowing an indexed lookup — a
 * hash-only scheme would have to hash-then-query, which is the same thing with
 * extra steps, and an id-only scheme is a bearer token sitting in plaintext.
 */
const COOKIE_SEPARATOR = ".";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SessionCookie = { name: string; value: string; options: object };

/** Cookie attributes shared by the set and clear paths, so they cannot drift. */
function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // Lax rather than Strict: the OAuth callback is a top-level cross-site
    // navigation back from the provider, and Strict would withhold the cookie
    // on that first request and bounce the user straight back to /login.
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * Issues a session row and returns the cookie to set on the response.
 * The plaintext secret exists only here and in the user's cookie.
 */
export async function createSession(
  userId: string,
  { userAgent }: { userAgent?: string | null } = {},
): Promise<SessionCookie> {
  const secret = randomBytes(32).toString("base64url");
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 512) ?? null,
    },
  });

  return {
    name: SESSION_COOKIE,
    value: `${session.id}${COOKIE_SEPARATOR}${secret}`,
    options: cookieOptions(Math.floor(SESSION_TTL_MS / 1000)),
  };
}

/**
 * Resolves a cookie value to its user id, or null when it is absent, malformed,
 * expired, or revoked. Expired rows are deleted on sight so the table does not
 * grow without a sweeper.
 */
export async function resolveSession(
  cookieValue: string | undefined,
): Promise<{ userId: string; sessionId: string } | null> {
  if (!cookieValue) return null;

  const separator = cookieValue.indexOf(COOKIE_SEPARATOR);
  if (separator <= 0) return null;
  const sessionId = cookieValue.slice(0, separator);
  const secret = cookieValue.slice(separator + 1);
  if (!secret) return null;

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Constant-time: a plain === leaks how many leading characters matched, and
  // the attacker controls the input, so the timing is measurable.
  const expected = Buffer.from(session.tokenHash, "hex");
  const actual = Buffer.from(hashToken(secret), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  return { userId: session.userId, sessionId: session.id };
}

/**
 * Revokes one session. Called on sign-out.
 *
 * Resolves first rather than deleting by the id half alone: the id is a cuid,
 * which is guessable enough that deleting on it unverified would let anyone
 * force-log-out a targeted user. The secret is the proof of ownership.
 */
export async function destroySession(cookieValue: string | undefined): Promise<void> {
  const resolved = await resolveSession(cookieValue);
  if (!resolved) return;
  await prisma.session.delete({ where: { id: resolved.sessionId } }).catch(() => {
    // Already gone. Sign-out is idempotent.
  });
}

/** Writes the session cookie onto a response. */
export function setSessionCookie(response: NextResponse, cookie: SessionCookie): void {
  response.cookies.set(cookie.name, cookie.value, cookie.options);
}

/** Clears the session cookie, matching the attributes it was set with. */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
}
