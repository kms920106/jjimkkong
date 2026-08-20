import type { AuthProvider, UserProfile } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { blindIndex, sealPhone } from "./phone-crypto";
import type { LocalMobile } from "./phone";
import type { ProviderProfile } from "./providers";

/**
 * What a provider sign-in resolved to.
 *
 * `pendingPhone` is the branch that makes the phone the merge key: nothing yet
 * tells us whether this is a new person or an existing one signing in through a
 * second provider, and only a number proven by SMS can answer that. The caller
 * must run the challenge and come back through `completeIdentityLink` — no
 * session is issued until then.
 *
 * `linked` therefore only ever means a returning sign-in.
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
 *     lands here regardless of what else changed, and this is the only path
 *     that issues a session directly.
 *  2. Everything else goes to the SMS challenge: both a brand-new person and
 *     the account merge (signing in with Kakao after registering with Naver).
 *     Registration and merge are the same code path precisely because we do not
 *     know which one it is until the number is proven.
 *
 * Email is deliberately not a matching key. Providers do not all verify the
 * addresses they hand out, and matching on an unverified one lets anybody who
 * can set an email at a sloppy provider take over the matching account here.
 */
export async function linkProviderIdentity(
  provider: AuthProvider,
  profile: ProviderProfile,
): Promise<LinkOutcome> {
  // findFirst on withdrawnAt: null, not findUnique — the pair is only unique
  // among live rows now (a partial unique index; see the soft-delete
  // migration), because a withdrawn identity keeps the provider id it was
  // created with. Matching a withdrawn row here would hand a returning user
  // their withdrawn account back instead of starting them fresh, which is
  // exactly what withdrawal is supposed to prevent.
  const existing = await prisma.authIdentity.findFirst({
    where: {
      provider,
      providerUserId: profile.providerUserId,
      withdrawnAt: null,
    },
    include: { user: true },
  });

  if (existing) {
    // Refresh what the provider last told us, but never overwrite a profile
    // field the user has since set themselves. The provider's phone number is
    // not recorded here — see the note on AuthIdentity in the schema.
    await prisma.authIdentity.update({
      where: { id: existing.id },
      data: { email: profile.email },
    });
    const user = await backfillProfile(existing.user, profile);
    return { status: "linked", user };
  }

  // Every first-time sign-in goes to the SMS challenge, including the one where
  // the provider handed us a number it says it verified itself. The number is
  // the merge key and the only credential this app has besides the provider
  // session, so it is proven on the device that will hold the session — not
  // asserted by a third party whose verification we cannot inspect, whose
  // records may be stale, and whose consent screen the user may have clicked
  // through without reading. The profile travels into the pending cookie only
  // so the form can prefill the number; completeIdentityLink uses the number the
  // user actually proved.
  return { status: "pendingPhone", provider, profile };
}

/**
 * Second half of the `pendingPhone` branch, called once the SMS code for
 * `phone` has been verified. `phone` is always the number the user proved on
 * this device; the one the provider may have supplied is never substituted for
 * it, even when the two agree.
 */
export async function completeIdentityLink(
  provider: AuthProvider,
  profile: ProviderProfile,
  phone: LocalMobile,
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
  phone: LocalMobile,
): Promise<UserProfile> {
  // Sealed once, outside the transaction: encryptPhone() uses a random IV, so
  // calling it twice for one number yields two different ciphertexts. Only one
  // is written here, but deriving the pair in a single place is what keeps the
  // hash and the ciphertext describing the same number.
  const sealed = sealPhone(phone);

  return prisma.$transaction(async (tx) => {
    // Live rows only, matching the partial unique index that now backs the
    // number. This is the decision point for the withdraw-then-return case: the
    // withdrawn row is invisible here, so `owner` is null and a brand-new
    // person is created with the same phone — which the index permits, because
    // it only constrains rows where withdrawnAt IS NULL.
    const owner = await tx.userProfile.findFirst({
      where: { phoneHash: sealed.hash, withdrawnAt: null },
    });

    const user =
      owner ??
      (await tx.userProfile.create({
        data: {
          email: profile.email,
          nickname: profile.name,
          phoneHash: sealed.hash,
          phoneEnc: sealed.enc,
          phoneVerifiedAt: new Date(),
        },
      }));

    await tx.authIdentity.create({
      data: {
        userId: user.id,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
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

/**
 * Signup was attempted on a number that already has a password.
 *
 * Distinct from every other signup failure because it is the one the user can act
 * on: the answer is to sign in, or to reset the password if they have forgotten it.
 *
 * It does disclose that the number is registered *with a password*, but only to a
 * caller who has just proven ownership of that number by SMS. That is not an
 * enumeration oracle — walking the number space would cost one delivered message
 * and one correct code per number, and the code only reaches the number's actual
 * holder. The send and verify steps stay uniform; this is the first point where
 * the flow knows the caller owns the number.
 */
export class PhoneAlreadyRegisteredError extends Error {
  constructor() {
    super("이미 가입된 휴대폰 번호입니다.");
    this.name = "PhoneAlreadyRegisteredError";
  }
}

/**
 * Creates or claims the account for a phone-only signup, setting its password.
 *
 * `phone` must already have been proven by SMS — the caller is a password route
 * standing behind a verified challenge. `passwordHash` is a finished verifier from
 * lib/auth/password.ts; this function never sees a plaintext password.
 *
 * Reuses the live account for the number when one exists, which is the same owner
 * lookup attachIdentity() and the password login route perform, so a person who
 * signed in with Naver first and now sets a password stays one profile.
 *
 * But it only *claims* an account that has no password yet. An account that
 * already has one is a completed signup, and overwriting it would make this route
 * a second password-reset endpoint — one without the reset flow's session
 * revocation, so the previous holder's sessions would survive the change. Number
 * recycling is the concrete case: a carrier reassigns a number, and the new holder
 * proves it by SMS and inherits the previous holder's account. Throwing here keeps
 * "set a password for the first time" and "replace an existing password" as the
 * separate operations they are — the latter is replacePhonePassword(), behind the
 * reset intent.
 */
export async function upsertPhonePassword(
  phone: LocalMobile,
  passwordHash: string,
): Promise<UserProfile> {
  const sealed = sealPhone(phone);

  return prisma.$transaction(async (tx) => {
    // Live rows only, matching the partial unique index. A withdrawn profile
    // holding this number is invisible, so a returning user gets a fresh account
    // rather than their withdrawn one back.
    const owner = await tx.userProfile.findFirst({
      where: { phoneHash: sealed.hash, withdrawnAt: null },
    });

    if (!owner) {
      return tx.userProfile.create({
        data: {
          phoneHash: sealed.hash,
          phoneEnc: sealed.enc,
          phoneVerifiedAt: new Date(),
          passwordHash,
        },
      });
    }

    // Checked inside the transaction, alongside the owner lookup that found it:
    // two concurrent signups on one number must not both read "no password" and
    // both write one.
    if (owner.passwordHash) throw new PhoneAlreadyRegisteredError();

    return tx.userProfile.update({
      where: { id: owner.id },
      data: {
        passwordHash,
        // Filled in for an account that predates the column; never refreshed for
        // one that already has it, matching the other two paths.
        ...(owner.phoneVerifiedAt ? {} : { phoneVerifiedAt: new Date() }),
      },
    });
  });
}

/**
 * Replaces the password on an existing account, for the reset flow.
 *
 * Separate from upsertPhonePassword because reset must not create anything: a
 * reset request for a number with no account has to fail, and folding the two
 * together would silently turn "I forgot my password" into "sign me up". Returns
 * null when there is no live account, which the route reports as the same generic
 * failure it uses for every other reason.
 */
export async function replacePhonePassword(
  phone: LocalMobile,
  passwordHash: string,
): Promise<UserProfile | null> {
  const hash = blindIndex(phone);

  return prisma.$transaction(async (tx) => {
    const owner = await tx.userProfile.findFirst({
      where: { phoneHash: hash, withdrawnAt: null },
    });
    if (!owner) return null;

    return tx.userProfile.update({
      where: { id: owner.id },
      data: { passwordHash },
    });
  });
}
