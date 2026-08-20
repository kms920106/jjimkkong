import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { replacePhonePassword } from "@/lib/auth/link";
import { hashPassword } from "@/lib/auth/password";
import { spendProvenPhone } from "@/lib/auth/phone-challenge-flow";
import { clearPhoneChallengeCookie } from "@/lib/auth/phone-login";
import {
  createSession,
  destroyAllSessionsForUser,
  setSessionCookie,
} from "@/lib/auth/session";
import { SmsVerificationError } from "@/lib/auth/sms";

const BodySchema = z.object({ password: z.string().min(1) });

/**
 * Step 3 of resetting a password: replace it and issue a session.
 *
 * Creates nothing. A reset for a number with no live account fails here rather
 * than quietly signing the caller up — but it fails with the same message the
 * expired-challenge case uses, because distinguishing them would reveal whether
 * the number has an account.
 */
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);

    const phone = await spendProvenPhone(request, "reset");
    if (!phone) {
      throw new SmsVerificationError(
        "휴대폰 인증이 필요합니다. 처음부터 다시 시도해 주세요.",
        401,
      );
    }

    const { password } = BodySchema.parse(await request.json());
    const passwordHash = await hashPassword(password);

    const user = await replacePhonePassword(phone, passwordHash);
    if (!user) {
      // Same wording as a missing challenge above, deliberately: "this number has
      // no account" is exactly the fact that must not leak from an endpoint anyone
      // can reach.
      throw new SmsVerificationError(
        "휴대폰 인증이 필요합니다. 처음부터 다시 시도해 주세요.",
        401,
      );
    }

    // Every session for this account is revoked, not just this browser's. A reset
    // is usually a response to "someone else may be in my account", and it would be
    // worth little if the other party's session kept working — this is what
    // database-backed sessions are for. Ordered before createSession so the new
    // cookie issued below is not caught by it.
    await destroyAllSessionsForUser(user.id);

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
