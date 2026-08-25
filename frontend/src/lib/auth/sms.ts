import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { LocalMobile } from "./phone";
import { blindIndex } from "./phone-crypto";

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

/**
 * Sends allowed for one attempt, across every number it tries.
 *
 * The limits above are all keyed on the destination number, which bounds abuse
 * *of a number* but not abuse *by one caller*. On the OAuth leg that is the whole
 * story: the pending cookie is deliberately replayable for its 10-minute TTL, so
 * without this budget one OAuth round trip would fund a send to a fresh number
 * every 30 seconds. Three is enough for a typo and a resend.
 *
 * How much this is worth depends on how the caller got its `purpose`, and the two
 * flows differ. `login:<provider>:<nonce>` is minted inside a
 * provider-authenticated callback, so resetting the budget costs a full OAuth
 * consent round trip — the bound holds against a hostile caller. `phone:<nonce>`
 * is minted by the send request itself, so discarding the cookie resets it; there
 * the budget only catches honest clients (a stuck retry, a mistyped number) and
 * abuse across numbers is left to the per-number ceilings and to edge rate
 * limiting. See the docstring on PHONE_CHALLENGE_COOKIE.
 */
const MAX_SENDS_PER_PENDING = 3;

/**
 * Sends allowed from one caller per hour, across every number they try.
 *
 * The last axis, and the only one keyed on something the caller cannot discard.
 * `purpose` bounds an attempt but a phone-only sign-in mints its own, and the
 * per-number ceilings cannot see across numbers by construction — so without
 * this, an unauthenticated caller can walk a list of numbers at one SMS each and
 * the ceiling is the Solapi balance.
 *
 * Set at the same 5/hour as the per-number limit: a real person verifies one
 * number, maybe two after a typo. The cost of it being wrong is a shared-address
 * user waiting an hour, which is why it is not lower — offices and mobile
 * carriers put many people behind one address.
 */
const MAX_SENDS_PER_SENDER_HOUR = 5;

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

function hashCode(phone: LocalMobile, purpose: string, code: string): string {
  // The phone and purpose are folded in so a hash cannot be lifted from one
  // challenge row and replayed against another.
  //
  // The *plaintext* number, deliberately, even though the column stores a blind
  // index. Both callers already hold it — it arrived in the request body — and
  // using it means a stolen table dump does not contain the number this hash was
  // built from, so the 10^6 code space cannot be ground through offline with
  // only the row in hand.
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
 * a Naver login cannot be redeemed to complete a Kakao one. It also carries the
 * per-login send budget, which is a separate axis from the per-number limits —
 * see MAX_SENDS_PER_PENDING.
 *
 * Deliberately does not check `phone` against anything. The user chooses the
 * number and proves it, and which account they land on follows from the number
 * they proved; constraining it to one the provider supplied would block a
 * legitimate number change without making the code any harder to guess.
 */
export async function startPhoneVerification(
  phone: LocalMobile,
  purpose: string,
  senderKey: string | null = null,
): Promise<void> {
  const now = new Date();
  // Every per-number query below is an equality match, so the deterministic hash
  // serves them all. The plaintext stays in this function for hashCode() and the
  // send itself.
  const phoneHash = blindIndex(phone);

  // Checked before the per-number limits: this one bounds how many *different*
  // numbers a single attempt can reach, which is the axis the per-number limits
  // cannot see. `purpose` is `login:<provider>:<nonce>` for the OAuth leg and
  // `phone:<nonce>` for phone-only sign-in, both with a fresh nonce per attempt,
  // so counting rows for it counts that attempt's sends — including the ones
  // already retired by the sweep below, which is why it counts rows rather than
  // live ones. Only the OAuth nonce is expensive to remint; see the constant.
  // Checked first, because it is the only limit a hostile caller cannot reset. The
  // two below are still worth having — they bound a number's exposure and catch an
  // honest client's retry loop — but neither can see one caller fanning out.
  //
  // Skipped when the address is unknown rather than failing closed: the platform
  // not supplying a header must not make signing in impossible, and a caller who
  // can suppress it is not thereby granted more than the per-number ceilings.
  if (senderKey) {
    const perSender = await prisma.phoneVerification.count({
      where: {
        senderKey,
        createdAt: { gt: new Date(now.getTime() - 1000 * 60 * 60) },
      },
    });
    if (perSender >= MAX_SENDS_PER_SENDER_HOUR) {
      throw new SmsVerificationError(
        "인증번호 요청 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
        429,
      );
    }
  }

  const perPending = await prisma.phoneVerification.count({ where: { purpose } });
  if (perPending >= MAX_SENDS_PER_PENDING) {
    throw new SmsVerificationError(
      "인증번호 요청 횟수를 초과했습니다. 처음부터 다시 시도해 주세요.",
      429,
    );
  }

  const recent = await prisma.phoneVerification.findFirst({
    where: {
      phoneHash,
      createdAt: { gt: new Date(now.getTime() - RESEND_COOLDOWN_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    throw new SmsVerificationError(
      "인증번호를 방금 보냈습니다. 30초 후에 다시 시도해 주세요.",
      429,
    );
  }

  const hourlyCount = await prisma.phoneVerification.count({
    where: { phoneHash, createdAt: { gt: new Date(now.getTime() - 1000 * 60 * 60) } },
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
    where: { phoneHash, createdAt: { gt: new Date(now.getTime() - 1000 * 60 * 60) } },
    _sum: { attempts: true },
  });
  if ((recentAttempts._sum.attempts ?? 0) >= MAX_ATTEMPTS_PER_HOUR) {
    throw new SmsVerificationError(
      "인증 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
      429,
    );
  }

  const code = generateCode();

  // Retire any still-live challenge for this number *within this purpose*, so
  // exactly one code per attempt is redeemable. Otherwise old unconsumed rows
  // linger until expiry and each carries its own untouched attempt budget.
  //
  // Scoped to `purpose` rather than the number alone. Sweeping every live row for
  // the number was equivalent while one number could only ever have one attempt
  // in flight — every challenge belonged to the single OAuth login that minted
  // it. Phone-only sign-in broke that: a user who starts /verify-phone, receives
  // a code, then opens the login drawer and requests a phone-only code for the
  // same number would have the first code silently retired, and verifyPhoneCode
  // would answer "request one first" about a code sitting in their SMS inbox.
  // One redeemable code per attempt is what the invariant above actually needs.
  await prisma.phoneVerification.updateMany({
    where: { phoneHash, purpose, consumedAt: null },
    data: { consumedAt: now },
  });

  // Recorded before sending. If the send fails the row is deleted below; doing
  // it the other way round would let a user receive a code that was never
  // stored, which reads to them as the service silently losing their code.
  const challenge = await prisma.phoneVerification.create({
    data: {
      phoneHash,
      purpose,
      senderKey,
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
  phone: LocalMobile,
  purpose: string,
  code: string,
): Promise<number> {
  const phoneHash = blindIndex(phone);

  const challenge = await prisma.phoneVerification.findFirst({
    where: { phoneHash, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    // Nothing redeemable — but "never requested" and "already redeemed" are
    // different situations and telling them apart is what stops the confusing
    // case. A user whose code was accepted, and who then edits the field and
    // submits again (the step after verify can reject, leaving the code form on
    // screen), was being told to request a code they had already used
    // successfully. The row is filtered out of the lookup above by
    // `consumedAt: null`, so it has to be looked for separately.
    //
    // Scoped to this purpose, so it says nothing about codes from other attempts.
    const spentRecently = await prisma.phoneVerification.findFirst({
      where: { phoneHash, purpose, consumedAt: { not: null } },
      orderBy: { consumedAt: "desc" },
      select: { id: true },
    });
    throw new SmsVerificationError(
      spentRecently
        ? "이미 인증이 완료된 번호입니다. 다음 단계를 진행해 주세요."
        : "인증번호를 먼저 요청해 주세요.",
    );
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
    where: { phoneHash, createdAt: { gt: new Date(Date.now() - 1000 * 60 * 60) } },
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

  // Consumed rather than deleted, so the row survives to be found. It is *not*
  // visible to the lookup at the top of this function, which filters
  // `consumedAt: null` — that is why the no-challenge branch there looks for a
  // consumed row separately before choosing its message. Deleting instead would
  // make an already-redeemed code indistinguishable from one never sent.
  await prisma.phoneVerification.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  // Returned so a caller that hands the proof onward to a later request — the
  // password flows do — can bind it to this exact row and spend it once. See
  // `spentAt` in the schema.
  return challenge.id;
}

/**
 * Hands the code to Solapi.
 *
 * Solapi has no OTP-specific endpoint — verification codes go out as ordinary
 * SMS, which is why the challenge lifecycle above is ours to own. The SDK is
 * imported lazily so a build without SMS configured does not pull it into
 * every route bundle.
 */
async function sendVerificationSms(phone: LocalMobile, code: string): Promise<void> {
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
    // Solapi wants bare local digits, which is now the stored and normalized
    // form as well — so there is nothing to convert here any more.
    await service.send({
      to: phone,
      from: from.replace(/[^\d]/g, ""),
      text: `[찜꽁] 인증번호 ${code}를 입력해 주세요.`,
    });
  } catch (cause) {
    // The SDK's error codes are not enumerated in its docs, so the specific
    // reason (unregistered sender, empty balance, bad number) is only visible
    // in the log — the user gets one retryable message either way.
    //
    // Narrowed rather than logging `cause` whole: the SDK's error can embed the
    // request payload, which holds the destination number and the code text.
    // Logs are storage, and the number is encrypted everywhere else it is
    // stored — dumping it here would put back exactly what that buys.
    console.error("Solapi send failed:", {
      name: cause instanceof Error ? cause.name : "unknown",
      message: cause instanceof Error ? cause.message : String(cause),
    });
    throw new SmsDeliveryError(
      "인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

