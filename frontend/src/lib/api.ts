import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth";
import { UnsupportedUrlError } from "@/lib/ingest/metadata";
import { LlmRateLimitedError } from "@/lib/ingest/extract";
import { SmsDeliveryError, SmsVerificationError } from "@/lib/auth/sms";
import { PasswordPolicyError } from "@/lib/auth/password";
import { PhoneAlreadyRegisteredError } from "@/lib/auth/link";
import { PasswordAttemptError } from "@/lib/auth/password-attempts";
import { OAuthConfigError, OAuthFlowError } from "@/lib/auth/providers";

/** Thrown when a mutating request arrives from another origin. */
export class CrossOriginError extends Error {
  constructor() {
    super("Cross-origin request");
    this.name = "CrossOriginError";
  }
}

/**
 * Rejects mutating requests whose Origin is not this deployment.
 *
 * Belt to the browser's braces, not a replacement for them. SameSite=Lax
 * already withholds the session cookie from script-initiated cross-site
 * requests, and a JSON-bodied DELETE additionally forces a CORS preflight this
 * app never answers — so forgery is not reachable today. Both of those are
 * browser defaults we do not control, though, and loosening CORS on /api/*
 * later (a native client, a sibling subdomain) would silently open every
 * mutating route at once. This makes the boundary something the server asserts.
 */
export function requireSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  // Browsers always send Origin on non-GET. Its absence means a non-browser
  // caller (curl, a server), which carries no ambient cookie to ride on — so
  // rejecting it would break those without closing an attack path.
  if (origin === null) return;
  if (origin !== new URL(request.url).origin) throw new CrossOriginError();
}

/** Maps known failures onto status codes; anything else becomes a 500. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (error instanceof CrossOriginError) {
    return NextResponse.json(
      { error: "요청을 처리할 수 없습니다." },
      { status: 403 },
    );
  }
  // Carries its own status: the wrong-code, expired, and rate-limited cases
  // are all user-correctable but map onto different codes.
  if (error instanceof SmsVerificationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // 409, not 400: the request is well formed and the caller proved the number —
  // what conflicts is the account that already exists on it. The message tells the
  // user the two ways forward (sign in, or reset), so the signup form can show it
  // verbatim.
  if (error instanceof PhoneAlreadyRegisteredError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  // Length rules only; the message names the limit the user missed.
  if (error instanceof PasswordPolicyError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // Its own 429, and separate from the SMS limiter: password attempts send no
  // message, so they are budgeted on a different axis.
  if (error instanceof PasswordAttemptError) {
    return NextResponse.json({ error: error.message }, { status: 429 });
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
