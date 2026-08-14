import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  DEV_SESSION_COOKIE,
  DEV_USER_EMAIL,
  DEV_USER_ID,
  isDevSessionValue,
} from "@/lib/dev-auth";
import type { UserProfile } from "@/generated/prisma/client";

/**
 * Thrown when a request has no valid Supabase session. API routes catch this
 * and return 401.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/**
 * Verifies the request's session and returns the matching UserProfile row,
 * creating it on first sign-in. Every API route must call this and scope its
 * queries by the returned id — Prisma connects as the table owner and
 * therefore bypasses row-level security.
 */
export async function requireUser(): Promise<UserProfile> {
  // Dev test session; see dev-auth.ts for why this is unconditional.
  const store = await cookies();
  if (isDevSessionValue(store.get(DEV_SESSION_COOKIE)?.value)) {
    return prisma.userProfile.upsert({
      where: { id: DEV_USER_ID },
      update: { email: DEV_USER_EMAIL },
      create: { id: DEV_USER_ID, email: DEV_USER_EMAIL },
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new UnauthorizedError();

  return prisma.userProfile.upsert({
    where: { id: user.id },
    update: { email: user.email ?? null },
    create: { id: user.id, email: user.email ?? null },
  });
}
