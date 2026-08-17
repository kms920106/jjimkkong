import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api";
import { normalizeKoreanMobile, maskKoreanMobile } from "@/lib/auth/phone";
import {
  openPending,
  PENDING_BINDING_COOKIE,
  PENDING_COOKIE,
  pendingPurpose,
} from "@/lib/auth/pending";
import { startPhoneVerification, SmsVerificationError } from "@/lib/auth/sms";

const BodySchema = z.object({ phone: z.string().min(1) });

/**
 * Sends a verification code for the pending login.
 *
 * Gated on the pending-login cookie rather than open to anyone: this endpoint
 * spends real money per call, so it must not be a public SMS gun.
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

    const { phone: raw } = BodySchema.parse(await request.json());
    const phone = normalizeKoreanMobile(raw);
    if (!phone) {
      throw new SmsVerificationError("휴대폰 번호 형식이 올바르지 않습니다.");
    }

    await startPhoneVerification(phone, pendingPurpose(pending));

    return NextResponse.json({ sent: true, phone: maskKoreanMobile(phone) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
