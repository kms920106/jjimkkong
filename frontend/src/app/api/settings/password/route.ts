import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { requireMember } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  clearPasswordAttempts,
  countPasswordAttempt,
} from "@/lib/auth/password-attempts";
import { senderKeyOf } from "@/lib/auth/sender-key";
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
 * A change requires the current password, not just the session. A session alone is
 * the wrong gate for minting a credential: a stolen or borrowed one would otherwise
 * plant a password and convert temporary access into permanent access the owner
 * does not know about. Knowing the existing password is what distinguishes the
 * owner from someone holding their session.
 *
 * A *first* set has nothing to know, so it passes on the session alone. That is a
 * deliberate narrowing of what this route used to require (a fresh SMS proof of the
 * account's own number, on top of the current password) — the flow now matches the
 * two-screen design, and SMS remains the gate on the paths where the caller has no
 * password to prove: POST /api/auth/phone/reset/* recovers an account whose password
 * is unknown, and it is still the only way in for a first login.
 */
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireMember();

    const { password, currentPassword } = BodySchema.parse(await request.json());

    // A change, not a first set: prove knowledge of the old password. Verified
    // before the new one is hashed so a failure costs one scrypt rather than two.
    if (user.passwordHash) {
      // Budgeted on the same axes as phone login — this comparison is a password
      // oracle too, and the route is reachable with nothing but a session. Counted
      // before the comparison so guesses cannot be spent uncounted.
      const senderKey = senderKeyOf(request);
      await countPasswordAttempt(senderKey);

      const ok =
        currentPassword !== undefined &&
        (await verifyPassword(currentPassword, user.passwordHash));
      if (!ok) {
        throw new SmsVerificationError(
          "현재 비밀번호가 올바르지 않습니다.",
          403,
        );
      }

      // Successes must not accumulate, or a shared address behind NAT spends its
      // budget on ordinary correct use. Only failures should stack.
      if (user.phoneHash) await clearPasswordAttempts(senderKey, user.phoneHash);
    }

    const passwordHash = await hashPassword(password);

    await prisma.member.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
