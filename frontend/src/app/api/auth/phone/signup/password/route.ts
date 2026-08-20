import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { upsertPhonePassword } from "@/lib/auth/link";
import { hashPassword } from "@/lib/auth/password";
import { spendProvenPhone } from "@/lib/auth/phone-challenge-flow";
import { clearPhoneChallengeCookie } from "@/lib/auth/phone-login";
import {
  createSession,
  destroySession,
  SESSION_COOKIE,
  setSessionCookie,
} from "@/lib/auth/session";
import { SmsVerificationError } from "@/lib/auth/sms";

const BodySchema = z.object({ password: z.string().min(1) });

/**
 * Step 3 of signing up: set the password and issue the session.
 *
 * The number is taken from the verified challenge cookie, never from the request
 * body — the body naming a number would let a caller who proved one number set a
 * password on another. This is the only place a phone-signup session is issued, and
 * it is adjacent to the password write so no intermediate state exists where an
 * account has been created without its credential.
 */
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);

    const phone = await spendProvenPhone(request, "signup");
    if (!phone) {
      throw new SmsVerificationError(
        "휴대폰 인증이 필요합니다. 처음부터 다시 시도해 주세요.",
        401,
      );
    }

    const { password } = BodySchema.parse(await request.json());
    // Throws PasswordPolicyError on a too-short or too-long password, which
    // toErrorResponse maps to a 400 carrying the Korean message.
    const passwordHash = await hashPassword(password);

    const user = await upsertPhonePassword(phone, passwordHash);

    // Rotate, matching every other login path: a session already in this browser
    // must not survive a sign-in.
    await destroySession(request.cookies.get(SESSION_COOKIE)?.value);

    const cookie = await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
    });
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, cookie);
    // Tidies the browser's copy; the proof was already spent server-side by
    // spendProvenPhone(), which is what prevents a replay.
    clearPhoneChallengeCookie(response);
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
