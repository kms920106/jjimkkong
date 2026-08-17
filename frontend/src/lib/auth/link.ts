import type { AuthProvider, UserProfile } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeKoreanMobile, type E164 } from "./phone";
import type { ProviderProfile } from "./providers";

/**
 * What a provider sign-in resolved to.
 *
 * `pendingPhone` is the branch that makes the phone the merge key: the
 * provider gave us no usable number, so we cannot yet tell whether this is a
 * new person or an existing one signing in through a second provider. The
 * caller must run the SMS challenge and come back through
 * `completeIdentityLink` — no session is issued until then.
 */
export type LinkOutcome =
  | { status: "linked"; user: UserProfile }
  | { status: "pendingPhone"; provider: AuthProvider; profile: ProviderProfile };

/**
 * Attaches a provider sign-in to a person, creating one if needed.
 *
 * Resolution order, and why:
 *  1. An existing AuthIdentity for [provider, providerUserId] — the only
 *     identifier the provider guarantees is stable. A returning user always
 *     lands here regardless of what else changed.
 *  2. A brand-new person, when the provider verified a phone nobody holds yet.
 *  3. Everything else goes to the SMS challenge — including the account merge
 *     (signing in with Kakao after registering with Naver), because attaching
 *     to an existing person must be proven on the device, not asserted by the
 *     provider.
 *
 * Email is deliberately not a matching key. Providers do not all verify the
 * addresses they hand out, and matching on an unverified one lets anybody who
 * can set an email at a sloppy provider take over the matching account here.
 */
export async function linkProviderIdentity(
  provider: AuthProvider,
  profile: ProviderProfile,
): Promise<LinkOutcome> {
  const existing = await prisma.authIdentity.findUnique({
    where: {
      provider_providerUserId: { provider, providerUserId: profile.providerUserId },
    },
    include: { user: true },
  });

  if (existing) {
    // Refresh what the provider last told us, but never overwrite a profile
    // field the user has since set themselves.
    await prisma.authIdentity.update({
      where: { id: existing.id },
      data: { email: profile.email, phone: profile.phone },
    });
    const user = await backfillProfile(existing.user, profile);
    return { status: "linked", user };
  }

  const phone = profile.phoneVerified
    ? normalizeKoreanMobile(profile.phone)
    : null;
  if (!phone) {
    // No usable number: the user declined the consent item, the provider does
    // not supply one, or it supplies one it never verified. Fall through to
    // the SMS challenge.
    return { status: "pendingPhone", provider, profile };
  }

  // Attaching to an account that already exists is the dangerous direction —
  // it hands this provider login the existing person's saved links. Make the
  // user prove the number on this device rather than trusting the provider's
  // word for it, even when that provider is one we trust to have checked.
  const owner = await prisma.userProfile.findUnique({ where: { phone } });
  if (owner) {
    return { status: "pendingPhone", provider, profile };
  }

  const user = await attachIdentity(provider, profile, phone);
  return { status: "linked", user };
}

/**
 * Second half of the `pendingPhone` branch, called once the SMS code for
 * `phone` has been verified. Same merge rule as above, with the number the
 * user proved they control instead of the one the provider withheld.
 */
export async function completeIdentityLink(
  provider: AuthProvider,
  profile: ProviderProfile,
  phone: E164,
): Promise<UserProfile> {
  return attachIdentity(provider, profile, phone);
}

/**
 * Creates the identity row against whichever person owns `phone`, creating
 * that person if the number is new.
 *
 * The whole thing is one transaction: two concurrent first sign-ins with the
 * same number would otherwise both see "no user" and both insert, and only the
 * unique on UserProfile.phone would stop it — as a 500 rather than a login.
 */
async function attachIdentity(
  provider: AuthProvider,
  profile: ProviderProfile,
  phone: E164,
): Promise<UserProfile> {
  return prisma.$transaction(async (tx) => {
    const owner = await tx.userProfile.findUnique({ where: { phone } });

    const user =
      owner ??
      (await tx.userProfile.create({
        data: {
          email: profile.email,
          nickname: profile.name,
          phone,
          phoneVerifiedAt: new Date(),
        },
      }));

    await tx.authIdentity.create({
      data: {
        userId: user.id,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        phone,
      },
    });

    // An account that predates this column gets it filled in on the next
    // sign-in, so existing users merge correctly from then on.
    if (owner && !owner.phoneVerifiedAt) {
      return tx.userProfile.update({
        where: { id: owner.id },
        data: { phoneVerifiedAt: new Date() },
      });
    }

    return user;
  });
}

/**
 * Fills in profile fields the user has never set. Only ever writes over null —
 * a nickname the user chose in the drawer must survive the next sign-in, even
 * if the provider disagrees with it.
 */
async function backfillProfile(
  user: UserProfile,
  profile: ProviderProfile,
): Promise<UserProfile> {
  const data: { email?: string; nickname?: string } = {};
  if (!user.email && profile.email) data.email = profile.email;
  if (!user.nickname && profile.name) data.nickname = profile.name;

  if (Object.keys(data).length === 0) return user;
  return prisma.userProfile.update({ where: { id: user.id }, data });
}
