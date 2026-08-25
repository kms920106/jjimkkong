import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { PhoneAlreadyRegisteredError } from "@/lib/auth/link";
import { blindIndex } from "@/lib/auth/phone-crypto";
import {
  maskKoreanMobile,
  normalizeKoreanMobile,
  type LocalMobile,
} from "@/lib/auth/phone";
import {
  openPhoneChallenge,
  phoneLoginPurpose,
  PHONE_CHALLENGE_BINDING_COOKIE,
  PHONE_CHALLENGE_COOKIE,
  sealPhoneChallenge,
  sealVerifiedChallenge,
  setPhoneChallengeCookie,
  setVerifiedChallengeCookie,
  type PhoneChallengeIntent,
} from "@/lib/auth/phone-login";
import { senderKeyOf } from "@/lib/auth/sender-key";
import {
  SmsVerificationError,
  startPhoneVerification,
  verifyPhoneCode,
} from "@/lib/auth/sms";
import { prisma } from "@/lib/prisma";

/**
 * The SMS legs shared by signup and password reset.
 *
 * Both are "prove the number, then set a password", and the only differences are
 * the challenge intent and whether an account is required to already exist. Those
 * are parameters, not separate implementations — duplicating the send/verify pair
 * would mean the rate limiting, the enumeration guards, and the cookie handling
 * each had two copies to keep in agreement.
 */

const SendSchema = z.object({ phone: z.string().min(1) });
const VerifySchema = z.object({
  phone: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "인증번호는 6자리 숫자입니다."),
});

/**
 * Sends a code for `intent`.
 *
 * The response is identical whether or not the number has an account. Reset is
 * where that matters most: telling the caller "no account with this number" would
 * turn this into a membership oracle for any number, and the reset flow is
 * reachable without any credential. A reset request for an unknown number
 * therefore sends a real SMS and reports success — the flow simply cannot be
 * completed, because the password step requires an existing account.
 */
export async function handleChallengeSend(
  request: NextRequest,
  intent: PhoneChallengeIntent,
): Promise<NextResponse> {
  try {
    requireSameOrigin(request);

    const { phone: raw } = SendSchema.parse(await request.json());
    const phone = normalizeKoreanMobile(raw);
    if (!phone) {
      throw new SmsVerificationError("휴대폰 번호 형식이 올바르지 않습니다.");
    }

    // Reused when it exists and matches this intent, so the per-attempt send
    // budget has something stable to count. A challenge left over from the other
    // intent is replaced rather than reused — the purpose namespaces the two, and
    // carrying one across would let a signup code finish a reset.
    const existing = openPhoneChallenge(
      request.cookies.get(PHONE_CHALLENGE_COOKIE)?.value,
      request.cookies.get(PHONE_CHALLENGE_BINDING_COOKIE)?.value,
    );
    const reusable = existing?.intent === intent ? existing : null;

    // One expression yields both the challenge and whether a cookie has to be set,
    // so the two cannot disagree.
    const attempt = reusable
      ? { challenge: reusable, cookie: null }
      : (() => {
          const minted = sealPhoneChallenge(intent);
          return { challenge: minted.challenge, cookie: minted };
        })();

    await startPhoneVerification(
      phone,
      phoneLoginPurpose(attempt.challenge),
      senderKeyOf(request),
    );

    const response = NextResponse.json({
      sent: true,
      phone: maskKoreanMobile(phone),
    });
    // Only on the freshly minted path: re-setting an existing cookie would push
    // its expiry out on every send, letting an attempt be kept alive past the TTL
    // that bounds it.
    if (attempt.cookie) {
      setPhoneChallengeCookie(
        response,
        attempt.cookie.value,
        attempt.cookie.binding,
      );
    }
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Redeems the code and records the proven number on the challenge.
 *
 * No session is issued here, which is the point of splitting verify from password:
 * a session before a password exists would be account access without the
 * credential the user is in the middle of setting. The proven number is written
 * into the challenge cookie so the password step can trust it rather than accept
 * whatever number that request names.
 */
export async function handleChallengeVerify(
  request: NextRequest,
  intent: PhoneChallengeIntent,
): Promise<NextResponse> {
  try {
    requireSameOrigin(request);

    const challenge = openPhoneChallenge(
      request.cookies.get(PHONE_CHALLENGE_COOKIE)?.value,
      request.cookies.get(PHONE_CHALLENGE_BINDING_COOKIE)?.value,
    );
    if (!challenge || challenge.intent !== intent) {
      throw new SmsVerificationError(
        "인증 시간이 만료되었습니다. 처음부터 다시 시도해 주세요.",
        401,
      );
    }

    const body = VerifySchema.parse(await request.json());
    const phone = normalizeKoreanMobile(body.phone);
    if (!phone) {
      throw new SmsVerificationError("휴대폰 번호 형식이 올바르지 않습니다.");
    }

    const verificationId = await verifyPhoneCode(
      phone,
      phoneLoginPurpose(challenge),
      body.code,
    );

    // Signup only, and deliberately *after* the code check: the caller has proven
    // they hold this number, so telling them it is already registered discloses
    // nothing they could not learn by trying to sign in with it. Before the code
    // check this would be an enumeration oracle for any number.
    //
    // Rejected here rather than in the password step so no proof is minted for a
    // signup that cannot complete. upsertPhonePassword() enforces the same rule
    // transactionally — that is the real guard, since this check and the write are
    // separate requests. This one exists so the user hears it while there is still
    // a screen to go back from, instead of hitting a spent-proof dead end.
    if (intent === "signup") {
      const owner = await prisma.member.findFirst({
        where: { phoneHash: blindIndex(phone), withdrawnAt: null },
        select: { passwordHash: true },
      });
      if (owner?.passwordHash) throw new PhoneAlreadyRegisteredError();
    }

    const verified = sealVerifiedChallenge(challenge, phone, verificationId);
    const response = NextResponse.json({ verified: true });
    setVerifiedChallengeCookie(response, challenge, verified.value);
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Spends the SMS proof and returns the number it was proven on, or null.
 *
 * The single gate the password routes stand on, and it is a *consuming* read. Three
 * things have to hold: the signed cookie pair opens, the intent matches, and the
 * PhoneVerification row it names is still unspent — the last one claimed by a
 * conditional update, so two concurrent requests carrying the same cookie cannot
 * both succeed.
 *
 * Spending is what makes the proof single-use. Clearing the cookie on the response
 * only evicts the browser's copy; a caller who saved the value could otherwise
 * replay it for the rest of the challenge's ten-minute life and rewrite the password
 * each time. The code was already single-use, but the *proof it produced* was not.
 */
export async function spendProvenPhone(
  request: NextRequest,
  intent: PhoneChallengeIntent,
): Promise<LocalMobile | null> {
  const challenge = openPhoneChallenge(
    request.cookies.get(PHONE_CHALLENGE_COOKIE)?.value,
    request.cookies.get(PHONE_CHALLENGE_BINDING_COOKIE)?.value,
  );
  if (!challenge || challenge.intent !== intent) return null;
  // `== null`, not falsy: the id is an int since 20260825, and a falsy test
  // would also reject 0. Unreachable today (identity columns start at 1), but
  // the predicate should say what it means.
  if (challenge.verificationId == null) return null;

  // Re-normalized rather than cast. The cookie is signed, so the value is ours and
  // was normalized when written — but the brand exists precisely so that no
  // un-normalized string can reach blindIndex(), where a mismatch is a silent
  // lookup miss rather than an error. Running it through the normalizer is what
  // earns the brand; asserting it would only hide a future format change.
  const phone = normalizeKoreanMobile(challenge.verifiedPhone);
  if (!phone) return null;

  // Claimed in one statement that both checks and sets. Reading `spentAt` and then
  // updating would be a check-then-act race: two requests replaying one cookie would
  // both read null and both proceed.
  const claimed = await prisma.phoneVerification.updateMany({
    where: { id: challenge.verificationId, spentAt: null },
    data: { spentAt: new Date() },
  });
  if (claimed.count === 0) return null;

  return phone;
}
