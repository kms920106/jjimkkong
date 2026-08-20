import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import {
  burnPasswordComparison,
  verifyPassword,
} from "@/lib/auth/password";
import { normalizeKoreanMobile } from "@/lib/auth/phone";
import { blindIndex } from "@/lib/auth/phone-crypto";
import { senderKeyOf } from "@/lib/auth/sender-key";
import {
  clearPasswordAttempts,
  countAccountAttempt,
  countPasswordAttempt,
} from "@/lib/auth/password-attempts";
import {
  createSession,
  destroySession,
  SESSION_COOKIE,
  setSessionCookie,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

const BodySchema = z.object({
  phone: z.string().min(1),
  password: z.string().min(1),
});

/**
 * The one Korean message every failure returns.
 *
 * "No account with this number", "this account has no password", and "wrong
 * password" are all the same response on purpose. Separating them would tell an
 * unauthenticated caller which numbers are registered and which of those use a
 * password, and this endpoint is reachable by anyone.
 */
const GENERIC_FAILURE = "휴대폰 번호 또는 비밀번호가 올바르지 않습니다.";

function failure(): NextResponse {
  return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
}

/**
 * Signs in with a phone number and password. No SMS.
 *
 * This is the only login path that spends no SMS, which is the point: verifying by
 * code on every sign-in costs money per login and makes the user wait on a message.
 * The number was proven once, at signup, and the password is what carries that
 * proof forward.
 *
 * Because it is unauthenticated and cheap to call, it needs its own brute-force
 * budget. The three SMS axes in sms.ts do not apply — they bound message sends, and
 * nothing is sent here — so attempts are counted separately; see
 * lib/auth/password-attempts.ts.
 */
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);

    const body = BodySchema.parse(await request.json());
    const phone = normalizeKoreanMobile(body.phone);

    // Counted before the number is even resolved, and keyed on the caller rather
    // than the account: an attacker walking many numbers must not get a fresh
    // budget per number, and a victim must not be lockable out by someone else
    // burning their account's counter.
    const senderKey = senderKeyOf(request);
    await countPasswordAttempt(senderKey);

    if (!phone) {
      // Burned anyway. Returning immediately on a malformed number would make
      // "this is not a valid Korean mobile" measurably faster than a real check,
      // and the same shortcut applied to unknown numbers is the oracle this route
      // exists to avoid.
      await burnPasswordComparison(body.password);
      return failure();
    }

    const phoneHash = blindIndex(phone);

    // The second axis, keyed on something the caller cannot rotate away. Counted
    // before the account lookup and regardless of whether one exists — budgeting
    // only known numbers would make the rate limit itself an oracle.
    await countAccountAttempt(phoneHash);

    const user = await prisma.userProfile.findFirst({
      where: { phoneHash, withdrawnAt: null },
    });

    // A withdrawn account is already excluded above, so it fails here like an
    // unknown number — withdrawal must not be reversible by signing in.
    if (!user?.passwordHash) {
      // Equal work for "no account" and "no password set", so scrypt's cost is
      // paid on every path and the response time does not classify the number.
      await burnPasswordComparison(body.password);
      return failure();
    }

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return failure();

    // Only failures should accumulate. Counting successes would spend an ordinary
    // user's allowance on ordinary logins, which behind a shared address means
    // locking out people who never guessed at anything.
    await clearPasswordAttempts(senderKey, phoneHash);

    // Rotate on success, matching the other login paths (session fixation).
    await destroySession(request.cookies.get(SESSION_COOKIE)?.value);

    const cookie = await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
    });
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, cookie);
    return response;
  } catch (error) {
    // PasswordAttemptError and PasswordPolicyError are both mapped in
    // toErrorResponse, so the rate-limit 429 and the policy 400 come out with their
    // own Korean messages rather than the generic 500.
    return toErrorResponse(error);
  }
}
