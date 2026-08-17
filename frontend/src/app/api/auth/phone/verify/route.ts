import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api";
import { completeIdentityLink } from "@/lib/auth/link";
import { normalizeKoreanMobile } from "@/lib/auth/phone";
import {
  clearPendingCookie,
  openPending,
  PENDING_BINDING_COOKIE,
  PENDING_COOKIE,
  pendingPurpose,
} from "@/lib/auth/pending";
import {
  createSession,
  destroySession,
  SESSION_COOKIE,
  setSessionCookie,
} from "@/lib/auth/session";
import { SmsVerificationError, verifyPhoneCode } from "@/lib/auth/sms";

const BodySchema = z.object({
  phone: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "인증번호는 6자리 숫자입니다."),
});

/**
 * Redeems the code and finishes the login the OAuth callback left pending.
 *
 * This is the only place a session is issued for the pending path — the code
 * check and the session creation are adjacent on purpose, so there is no
 * intermediate state an unverified caller can reach.
 */
export async function POST(request: NextRequest) {
  try {
    const pending = openPending(
      request.cookies.get(PENDING_COOKIE)?.value,
      request.cookies.get(PENDING_BINDING_COOKIE)?.value,
    );
    if (!pending) {
      throw new SmsVerificationError(
        "로그인 세션이 만료되었습니다. 처음부터 다시 시도해 주세요.",
        401,
      );
    }

    const body = BodySchema.parse(await request.json());
    const phone = normalizeKoreanMobile(body.phone);
    if (!phone) {
      throw new SmsVerificationError("휴대폰 번호 형식이 올바르지 않습니다.");
    }

    await verifyPhoneCode(phone, pendingPurpose(pending), body.code);

    const user = await completeIdentityLink(
      pending.provider,
      pending.profile,
      phone,
    );

    // Rotate, for the same reason as the OAuth callback: a session already in
    // this browser must not survive a login.
    await destroySession(request.cookies.get(SESSION_COOKIE)?.value);

    const cookie = await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
    });
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, cookie);
    clearPendingCookie(response);
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
