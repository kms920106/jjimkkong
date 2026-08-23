import { cookies } from "next/headers";
import { resolveSessionWithUser, SESSION_COOKIE } from "@/lib/auth/session";
import type { Member } from "@/generated/prisma/client";

/**
 * Thrown when a request has no valid session. API routes catch this and
 * return 401.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/**
 * Verifies the request's session and returns the signed-in Member.
 *
 * Every API route must call this and scope its queries by the returned id —
 * Prisma connects as the table owner and therefore bypasses row-level
 * security. The profile is created during sign-in (see lib/auth/link.ts), not
 * here, because creating a person requires a verified phone number to attach
 * them to; a session that resolves to a missing row is a deleted account and
 * must be rejected rather than silently recreated.
 *
 * A withdrawn profile is rejected the same way. Withdrawal keeps the row and
 * its saved links, so unlike a hard delete the lookup still succeeds — the
 * `withdrawnAt` filter is the only thing standing between a withdrawn account
 * and a fully working session. Dropping it from this query silently un-withdraws
 * every account in the system.
 */
export async function requireMember(): Promise<Member> {
  const store = await cookies();
  // One query, not two: the profile comes back joined onto the session, and it
  // is already filtered by `withdrawnAt` there. Splitting this back into a
  // findUnique plus a findFirst costs an extra serial round trip on every
  // authenticated render.
  const session = await resolveSessionWithUser(store.get(SESSION_COOKIE)?.value);
  if (!session?.member) throw new UnauthorizedError();

  return session.member;
}

/** Like requireMember(), but returns null instead of throwing. */
export async function getMember(): Promise<Member | null> {
  try {
    return await requireMember();
  } catch {
    return null;
  }
}
