import { AuthProvider } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { UserProfile } from "@/generated/prisma/client";

/**
 * Stand-in for a real social login, so the app can be exercised without going
 * through Naver. Unconditionally enabled — including in production builds —
 * because Naver Login is not review-approved yet and this is still the only
 * way to reach the app in every environment it runs in.
 *
 * This is a live authentication bypass: any unauthenticated caller can POST
 * /api/dev-login and become this fixed user. It must be closed before the app
 * is exposed publicly. Treat it as an open item, not scenery.
 *
 * Unlike the previous version, this issues an ordinary Session row through the
 * normal path rather than a magic cookie requireUser() has to special-case —
 * so there is exactly one way to be authenticated in this codebase.
 */
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_USER_EMAIL = "test@jjimkkong.local";
const DEV_PROVIDER_USER_ID = "dev-fixed-user";

/** Creates (or finds) the dev user and its identity row. */
export async function ensureDevUser(): Promise<UserProfile> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.userProfile.upsert({
      where: { id: DEV_USER_ID },
      // Un-withdraws on sign-in. The dev user is a fixed id rather than a
      // person, so withdrawing it is a test of the flow, not a decision to
      // respect — leaving the stamp on would brick the only way into the app in
      // every environment. Real accounts never take this path: they are matched
      // by provider identity or phone, both of which ignore withdrawn rows.
      update: { withdrawnAt: null },
      create: {
        id: DEV_USER_ID,
        email: DEV_USER_EMAIL,
        nickname: "테스트 계정",
        // No phone: the dev user must never collide with a real person's
        // number, and phone is unique among live rows.
      },
    });

    // findFirst + create rather than upsert: [provider, providerUserId] is only
    // unique among live rows now (partial unique index), so Prisma no longer
    // accepts it as an upsert target. Scoped to this user id as well as the
    // provider id, so a withdrawn identity row left over from an earlier cycle
    // does not satisfy the check and leave the new session with no identity.
    const identity = await tx.authIdentity.findFirst({
      where: {
        provider: AuthProvider.DEV,
        providerUserId: DEV_PROVIDER_USER_ID,
        userId: user.id,
      },
    });

    if (identity) {
      await tx.authIdentity.update({
        where: { id: identity.id },
        data: { withdrawnAt: null },
      });
    } else {
      await tx.authIdentity.create({
        data: {
          userId: user.id,
          provider: AuthProvider.DEV,
          providerUserId: DEV_PROVIDER_USER_ID,
          email: DEV_USER_EMAIL,
        },
      });
    }

    return user;
  });
}
