import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth";
import { UnsupportedUrlError } from "@/lib/ingest/metadata";
import { LlmRateLimitedError } from "@/lib/ingest/extract";
import { SmsDeliveryError, SmsVerificationError } from "@/lib/auth/sms";
import { OAuthConfigError, OAuthFlowError } from "@/lib/auth/providers";

/** Maps known failures onto status codes; anything else becomes a 500. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  // Carries its own status: the wrong-code, expired, and rate-limited cases
  // are all user-correctable but map onto different codes.
  if (error instanceof SmsVerificationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof SmsDeliveryError) {
    // 503, not 500: the provider is down or misconfigured, and retrying later
    // is the right advice.
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  if (error instanceof OAuthFlowError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof OAuthConfigError) {
    // Ours to fix, not the caller's — the message names the missing env var,
    // so it is logged rather than returned.
    console.error("OAuth configuration error:", error);
    return NextResponse.json(
      { error: "로그인 설정에 문제가 있습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
  if (error instanceof UnsupportedUrlError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof LlmRateLimitedError) {
    return NextResponse.json(
      { error: "오늘의 무료 추출 한도를 다 썼습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  console.error("Unhandled API error:", error);
  return NextResponse.json(
    { error: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
    { status: 500 },
  );
}
