import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth";
import { UnsupportedUrlError } from "@/lib/ingest/metadata";
import { LlmRateLimitedError, LlmRequestError } from "@/lib/ingest/extract";
import { SmsDeliveryError, SmsVerificationError } from "@/lib/auth/sms";
import { PasswordPolicyError } from "@/lib/auth/password";
import { PhoneAlreadyRegisteredError } from "@/lib/auth/link";
import { PasswordAttemptError } from "@/lib/auth/password-attempts";
import { ProfileImageError } from "@/lib/profile-image";
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

/**
 * The status and user-facing message for a failure, without building a
 * response around it.
 *
 * Split out for streaming routes. Once the first byte of a stream is written
 * the status line is already committed, so a failure mid-stream cannot become a
 * 4xx — it has to travel inside the body instead. Those routes still need the
 * exact same mapping, and duplicating it is how the two drift until one path
 * reports a raw 500 for something the other explains. `toErrorResponse()` is
 * now a thin wrapper over this, so adding a branch here covers both.
 */
export function describeError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof UnauthorizedError) {
    return { status: 401, message: "로그인이 필요합니다." };
  }
  if (error instanceof CrossOriginError) {
    return { status: 403, message: "요청을 처리할 수 없습니다." };
  }
  // Carries its own status: the wrong-code, expired, and rate-limited cases
  // are all user-correctable but map onto different codes.
  if (error instanceof SmsVerificationError) {
    return { status: error.status, message: error.message };
  }
  // 409, not 400: the request is well formed and the caller proved the number —
  // what conflicts is the account that already exists on it. The message tells the
  // user the two ways forward (sign in, or reset), so the signup form can show it
  // verbatim.
  if (error instanceof PhoneAlreadyRegisteredError) {
    return { status: 409, message: error.message };
  }
  // Type and size rules; the message names what was wrong so the profile form
  // can show it verbatim.
  if (error instanceof ProfileImageError) {
    return { status: 400, message: error.message };
  }
  // Length rules only; the message names the limit the user missed.
  if (error instanceof PasswordPolicyError) {
    return { status: 400, message: error.message };
  }
  // Its own 429, and separate from the SMS limiter: password attempts send no
  // message, so they are budgeted on a different axis.
  if (error instanceof PasswordAttemptError) {
    return { status: 429, message: error.message };
  }
  if (error instanceof SmsDeliveryError) {
    // 503, not 500: the provider is down or misconfigured, and retrying later
    // is the right advice.
    return { status: 503, message: error.message };
  }
  if (error instanceof OAuthFlowError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof OAuthConfigError) {
    // Ours to fix, not the caller's — the message names the missing env var,
    // so it is logged rather than returned.
    console.error("OAuth configuration error:", error);
    return { status: 503, message: "로그인 설정에 문제가 있습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (error instanceof UnsupportedUrlError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof LlmRateLimitedError) {
    return { status: 429, message: "오늘의 무료 추출 한도를 다 썼습니다. 잠시 후 다시 시도해 주세요." };
  }
  // 503 for the same reason OAuthConfigError is: the request was fine and the
  // failure is ours — a rejected body, a bad model name, a key without access.
  // A 500 here is what let a permanent misconfiguration read as a transient
  // blip, so this branch exists to keep the two apart in the logs.
  //
  // The provider's own text is logged and never returned: it names the model,
  // quotes our payload, and echoes internal field paths.
  if (error instanceof LlmRequestError) {
    console.error("LLM request error:", error);
    return {
      status: 503,
      message: "장소 추출 서비스에 문제가 있습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  if (error instanceof ZodError) {
    return { status: 400, message: "요청 형식이 올바르지 않습니다." };
  }

  console.error("Unhandled API error:", error);
  return { status: 500, message: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
}

/**
 * Maps known failures onto status codes; anything else becomes a 500.
 *
 * A thin wrapper over {@link describeError} so the two paths — this and the
 * in-stream error frame — can never disagree about what a failure means.
 */
export function toErrorResponse(error: unknown): NextResponse {
  const { status, message } = describeError(error);
  return NextResponse.json({ error: message }, { status });
}
