import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Member } from "@/generated/prisma/client";

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
    // on that first request, so the page it lands on would render as logged
    // out despite the login having just succeeded.
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
  memberId: number,
  { userAgent }: { userAgent?: string | null } = {},
): Promise<SessionCookie> {
  const secret = randomBytes(32).toString("base64url");
  const session = await prisma.session.create({
    data: {
      memberId,
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
): Promise<{ memberId: number; sessionId: number } | null> {
  const resolved = await resolveSessionWithUser(cookieValue);
  if (!resolved) return null;
  return { memberId: resolved.memberId, sessionId: resolved.sessionId };
}

/**
 * resolveSession plus the owning profile, fetched in the same query.
 *
 * Exists because the caller almost always needs the profile immediately after
 * (requireMember did session.findUnique then member.findFirst), and those two
 * are a strict chain on a foreign key — the second cannot start until the first
 * returns. Against a pooled Supabase connection from a Vercel function that is
 * two serial round trips where one join does the same work, which is the
 * difference the /links page render was paying twice over.
 *
 * `user` is null for a withdrawn account as well as a missing one: the relation
 * is filtered by `withdrawnAt` here so callers cannot forget it. Withdrawal
 * keeps the row, so an unfiltered join would hand back a working session for a
 * withdrawn account — see requireMember.
 */
export async function resolveSessionWithUser(
  cookieValue: string | undefined,
): Promise<
  { memberId: number; sessionId: number; member: Member | null } | null
> {
  if (!cookieValue) return null;

  // indexOf, not lastIndexOf: the secret half is base64url and may contain no
  // separator of its own, so the *first* one ends the id.
  const separator = cookieValue.indexOf(COOKIE_SEPARATOR);
  if (separator <= 0) return null;
  const rawSessionId = cookieValue.slice(0, separator);
  const secret = cookieValue.slice(separator + 1);
  if (!secret) return null;

  // Parsed rather than passed through: the id half is attacker-controlled text,
  // and Prisma throws on a malformed Int rather than returning no rows — which
  // would turn a junk cookie into a 500 instead of a signed-out visitor.
  // `Number.parseInt` would accept "1abc" and silently look up session 1; this
  // does not. Same guard as the route params, for the same reason.
  const sessionId = Number(rawSessionId);
  if (!Number.isInteger(sessionId) || sessionId < 1) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { member: true },
  });
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

  return {
    memberId: session.memberId,
    sessionId: session.id,
    // The join cannot express `withdrawnAt: null`, so it is applied here to
    // keep the one place that decides it.
    member: session.member.withdrawnAt === null ? session.member : null,
  };
}

/**
 * Revokes one session. Called on sign-out.
 *
 * Resolves first rather than deleting by the id half alone: the id is a
 * sequential integer, so anyone holding one valid cookie can name every other
 * session by counting, and deleting on it unverified would let them force-log-
 * out any chosen user. The secret is the proof of ownership.
 *
 * This was already true when the id was a cuid — "guessable enough to matter" —
 * and the 20260825 int migration made it certain rather than likely. The
 * verification is what the design rests on; do not add a revoke path that
 * trusts the id alone.
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

/**
 * Revokes every session belonging to one account.
 *
 * Used by the password reset, and the reason sessions live in the database at all:
 * a reset is usually a response to "someone else may be in my account", and it is
 * worth nothing if the other party's session keeps working. A self-contained token
 * could not be withdrawn like this.
 *
 * Called before the new session is created, so the caller's fresh cookie is not
 * caught by it.
 */
export async function destroyAllSessionsForUser(memberId: number): Promise<void> {
  await prisma.session.deleteMany({ where: { memberId } });
}
