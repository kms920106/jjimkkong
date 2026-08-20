import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { spendProvenPhone } from "@/lib/auth/phone-challenge-flow";
import { blindIndex } from "@/lib/auth/phone-crypto";
import { clearPhoneChallengeCookie } from "@/lib/auth/phone-login";
import { SmsVerificationError } from "@/lib/auth/sms";
import { prisma } from "@/lib/prisma";

const BodySchema = z.object({
  password: z.string().min(1),
  /**
   * Required when the account already has a password. Optional in the schema rather
   * than conditional, because whether it is needed depends on server state the
   * client does not get to decide.
   */
  currentPassword: z.string().optional(),
});

/**
 * Sets or changes the password on the signed-in account.
 *
 * Requires a session *and* a freshly proven number, not just the session. A
 * session alone is the wrong gate here: a stolen or borrowed one could otherwise
 * plant a password, which would convert temporary access into a permanent
 * credential the real owner does not know. Proving the number again is what stops
 * that, and the owner can always do it.
 *
 * The proven number must be this account's own. Without that check, someone could
 * verify any number they control and set a password on the account they are signed
 * into — harmless for their own account, but it would also mean the `reset` intent
 * and this route were interchangeable, and reset deliberately keys off the number
 * rather than the session.
 */
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();

    // The `reset` intent is reused rather than a third one added: the user-facing
    // action is the same ("prove my number, then set a password"), and a separate
    // intent would only create another namespace to keep in sync.
    const phone = await spendProvenPhone(request, "reset");
    if (!phone) {
      throw new SmsVerificationError(
        "휴대폰 인증이 필요합니다. 인증을 먼저 완료해 주세요.",
        401,
      );
    }

    // The number proven has to be the one on this account. Compared as blind
    // indexes because that is what the column holds — the plaintext is never
    // stored, so there is nothing else to compare.
    if (!user.phoneHash || user.phoneHash !== blindIndex(phone)) {
      throw new SmsVerificationError(
        "계정에 등록된 휴대폰 번호로 인증해 주세요.",
        403,
      );
    }

    const { password, currentPassword } = BodySchema.parse(await request.json());

    // A change, not a first set: prove knowledge of the old password. Verified before
    // the new one is hashed so a failure costs one scrypt rather than two.
    if (user.passwordHash) {
      const ok =
        currentPassword !== undefined &&
        (await verifyPassword(currentPassword, user.passwordHash));
      if (!ok) {
        throw new SmsVerificationError(
          "현재 비밀번호가 올바르지 않습니다.",
          403,
        );
      }
    }

    const passwordHash = await hashPassword(password);

    await prisma.userProfile.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    const response = NextResponse.json({ ok: true });
    // Tidies the browser's copy. The proof itself was already spent server-side by
    // spendProvenPhone(), which is what actually prevents a replay — clearing the
    // cookie alone would not, since a caller can keep the value.
    clearPhoneChallengeCookie(response);
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
