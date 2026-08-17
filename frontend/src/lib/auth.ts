import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { resolveSession, SESSION_COOKIE } from "@/lib/auth/session";
import type { UserProfile } from "@/generated/prisma/client";

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
 * Verifies the request's session and returns the signed-in UserProfile.
 *
 * Every API route must call this and scope its queries by the returned id —
 * Prisma connects as the table owner and therefore bypasses row-level
 * security. The profile is created during sign-in (see lib/auth/link.ts), not
 * here, because creating a person requires a verified phone number to attach
 * them to; a session that resolves to a missing row is a deleted account and
 * must be rejected rather than silently recreated.
 */
export async function requireUser(): Promise<UserProfile> {
  const store = await cookies();
  const session = await resolveSession(store.get(SESSION_COOKIE)?.value);
  if (!session) throw new UnauthorizedError();

  const user = await prisma.userProfile.findUnique({
    where: { id: session.userId },
  });
  if (!user) throw new UnauthorizedError();

  return user;
}

/** Like requireUser(), but returns null instead of throwing. */
export async function getUser(): Promise<UserProfile | null> {
  try {
    return await requireUser();
  } catch {
    return null;
  }
}
