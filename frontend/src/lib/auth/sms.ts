import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { E164 } from "./phone";

/** How long a code stays redeemable. */
const CODE_TTL_MS = 1000 * 60 * 5;

/** Wrong guesses allowed against a single code. */
const MAX_ATTEMPTS = 5;

/** Wrong guesses allowed against one number per hour, across all codes. */
const MAX_ATTEMPTS_PER_HOUR = 10;

/** Minimum gap between sends to one number, so resend cannot be used to spam. */
const RESEND_COOLDOWN_MS = 1000 * 30;

/** Sends allowed to one number per hour, capping the cost of an abused form. */
const HOURLY_SEND_LIMIT = 5;

/** Raised for every user-correctable failure; carries the message shown to them. */
export class SmsVerificationError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "SmsVerificationError";
  }
}

/** Raised when the SMS provider itself fails — retryable, and not the user's fault. */
export class SmsDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsDeliveryError";
  }
}

function hashCode(phone: string, purpose: string, code: string): string {
  // The phone and purpose are folded in so a hash cannot be lifted from one
  // challenge row and replayed against another.
  return createHash("sha256").update(`${phone}:${purpose}:${code}`).digest("hex");
}

/**
 * Cryptographically random, unlike Math.random(): these codes are the only
 * thing standing between an attacker and an account, and Math.random() is
 * seeded predictably enough to enumerate.
 */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Sends a verification code to `phone` and records the challenge.
 *
 * `purpose` scopes the challenge to one pending sign-in, so a code minted for
 * a Naver login cannot be redeemed to complete a Kakao one.
 */
export async function startPhoneVerification(
  phone: E164,
  purpose: string,
): Promise<void> {
  const now = new Date();

  const recent = await prisma.phoneVerification.findFirst({
    where: { phone, createdAt: { gt: new Date(now.getTime() - RESEND_COOLDOWN_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    throw new SmsVerificationError(
      "인증번호를 방금 보냈습니다. 30초 후에 다시 시도해 주세요.",
      429,
    );
  }

  const hourlyCount = await prisma.phoneVerification.count({
    where: { phone, createdAt: { gt: new Date(now.getTime() - 1000 * 60 * 60) } },
  });
  if (hourlyCount >= HOURLY_SEND_LIMIT) {
    throw new SmsVerificationError(
      "인증번호 요청 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
      429,
    );
  }

  // Total wrong guesses across every challenge for this number, not just the
  // current row. Without this the budget resets with each new code, so the
  // effective guess count against a 6-digit space is attempts × sends rather
  // than attempts.
  const recentAttempts = await prisma.phoneVerification.aggregate({
    where: { phone, createdAt: { gt: new Date(now.getTime() - 1000 * 60 * 60) } },
    _sum: { attempts: true },
  });
  if ((recentAttempts._sum.attempts ?? 0) >= MAX_ATTEMPTS_PER_HOUR) {
    throw new SmsVerificationError(
      "인증 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
      429,
    );
  }

  const code = generateCode();

  // Retire any still-live challenge for this number first, so exactly one code
  // is redeemable at a time. Otherwise old unconsumed rows linger until expiry
  // and each carries its own untouched attempt budget.
  await prisma.phoneVerification.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: now },
  });

  // Recorded before sending. If the send fails the row is deleted below; doing
  // it the other way round would let a user receive a code that was never
  // stored, which reads to them as the service silently losing their code.
  const challenge = await prisma.phoneVerification.create({
    data: {
      phone,
      purpose,
      codeHash: hashCode(phone, purpose, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
  });

  try {
    await sendVerificationSms(phone, code);
  } catch (cause) {
    await prisma.phoneVerification.delete({ where: { id: challenge.id } }).catch(() => {});
    throw cause;
  }
}

/**
 * Redeems a code. Returns normally on success; throws SmsVerificationError with
 * a user-facing message otherwise.
 *
 * A wrong guess increments `attempts` rather than deleting the row, so a typo
 * does not force the user to request a whole new code — but the budget is
 * finite, because a 6-digit space falls to brute force without one.
 */
export async function verifyPhoneCode(
  phone: E164,
  purpose: string,
  code: string,
): Promise<void> {
  const challenge = await prisma.phoneVerification.findFirst({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    throw new SmsVerificationError("인증번호를 먼저 요청해 주세요.");
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new SmsVerificationError("인증번호가 만료되었습니다. 다시 요청해 주세요.");
  }

  // Spend an attempt before comparing, in the same statement that checks the
  // cap. Reading `attempts` and then comparing would be a check-then-act race:
  // a hundred concurrent requests would all read the same pre-increment value,
  // all pass the cap, and all get a guess — turning a 5-guess budget into an
  // unbounded one against a space only 10^6 wide.
  const claimed = await prisma.phoneVerification.updateMany({
    where: {
      id: challenge.id,
      consumedAt: null,
      attempts: { lt: MAX_ATTEMPTS },
      expiresAt: { gt: new Date() },
    },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    throw new SmsVerificationError(
      "인증 시도 횟수를 초과했습니다. 인증번호를 다시 요청해 주세요.",
      429,
    );
  }

  // The hourly ceiling across every code sent to this number. The per-code cap
  // above resets with each resend, so on its own it bounds guesses per code
  // rather than per number.
  const spent = await prisma.phoneVerification.aggregate({
    where: { phone, createdAt: { gt: new Date(Date.now() - 1000 * 60 * 60) } },
    _sum: { attempts: true },
  });
  if ((spent._sum.attempts ?? 0) > MAX_ATTEMPTS_PER_HOUR) {
    throw new SmsVerificationError(
      "인증 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
      429,
    );
  }

  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(hashCode(phone, purpose, code.trim()), "hex");
  const ok =
    expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!ok) {
    const left = Math.max(0, MAX_ATTEMPTS - (challenge.attempts + 1));
    throw new SmsVerificationError(
      left > 0
        ? `인증번호가 올바르지 않습니다. (${left}회 남음)`
        : "인증 시도 횟수를 초과했습니다. 인증번호를 다시 요청해 주세요.",
    );
  }

  // Consumed rather than deleted, so a double-submit of the same form finds a
  // used row and fails cleanly instead of falling into "request one first".
  await prisma.phoneVerification.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });
}

/**
 * Hands the code to Solapi.
 *
 * Solapi has no OTP-specific endpoint — verification codes go out as ordinary
 * SMS, which is why the challenge lifecycle above is ours to own. The SDK is
 * imported lazily so a build without SMS configured does not pull it into
 * every route bundle.
 */
async function sendVerificationSms(phone: E164, code: string): Promise<void> {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const from = process.env.SOLAPI_SENDER_PHONE;

  if (!apiKey || !apiSecret || !from) {
    throw new SmsDeliveryError(
      "SMS 발송이 설정되지 않았습니다. (SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER_PHONE)",
    );
  }

  const { SolapiMessageService } = await import("solapi");
  const service = new SolapiMessageService(apiKey, apiSecret);

  try {
    // Solapi wants bare digits, not E.164 — `+8210…` is rejected.
    await service.send({
      to: toLocalDigits(phone),
      from: from.replace(/[^\d]/g, ""),
      text: `[찜꽁] 인증번호 ${code}를 입력해 주세요.`,
    });
  } catch (cause) {
    // The SDK's error codes are not enumerated in its docs, so the specific
    // reason (unregistered sender, empty balance, bad number) is only visible
    // in the log — the user gets one retryable message either way.
    console.error("Solapi send failed:", cause);
    throw new SmsDeliveryError(
      "인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

/** `+821012345678` → `01012345678`. */
function toLocalDigits(e164: E164): string {
  return `0${e164.replace(/^\+82/, "")}`;
}
