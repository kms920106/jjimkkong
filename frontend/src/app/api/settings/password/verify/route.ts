import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { requireMember } from "@/lib/auth";
import { verifyPassword } from "@/lib/auth/password";
import {
  clearPasswordAttempts,
  countPasswordAttempt,
} from "@/lib/auth/password-attempts";
import { senderKeyOf } from "@/lib/auth/sender-key";
import { SmsVerificationError } from "@/lib/auth/sms";

const BodySchema = z.object({
  currentPassword: z.string().min(1),
});

/**
 * Checks the current password without writing anything.
 *
 * Exists because the change flow asks for the current password on its own screen,
 * before the new one. Without this the user would type a new password twice and
 * only then learn the first screen was wrong — and the wording would have to be
 * vague about which of the two fields failed. It is a read-only pre-check, so the
 * write in POST /api/settings/password still verifies the current password itself:
 * this route grants nothing, and a caller who skips it gets the same refusal.
 *
 * Budgeted on the same PasswordAttempt axes as phone login, because this is a
 * password oracle too. The account axis is keyed on the session's own number
 * rather than a caller-supplied one, so nobody but the account holder can spend
 * that budget — which is why there is no denial-of-service concern here.
 */
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireMember();
    const { currentPassword } = BodySchema.parse(await request.json());

    // Counted before the comparison, so a caller cannot spend guesses uncounted
    // and concurrent requests cannot all read the same pre-increment total.
    const senderKey = senderKeyOf(request);
    await countPasswordAttempt(senderKey);

    // No password to check against. Not reachable from the UI — the flow skips
    // straight to the new-password screen — so this is the API being called
    // directly rather than a state the user can see.
    if (!user.passwordHash) {
      throw new SmsVerificationError("설정된 비밀번호가 없습니다.", 400);
    }

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new SmsVerificationError("현재 비밀번호가 올바르지 않습니다.", 403);
    }

    // Successes must not accumulate: a shared address behind NAT would otherwise
    // spend the budget on ordinary, correct use. Only failures should stack.
    if (user.phoneHash) await clearPasswordAttempts(senderKey, user.phoneHash);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
