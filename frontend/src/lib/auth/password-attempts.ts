import { prisma } from "@/lib/prisma";

/**
 * Brute-force budget for password sign-in.
 *
 * A separate axis from everything in sms.ts, because those limits all bound
 * *sending a message* — they count PhoneVerification rows, and a password attempt
 * creates none. Password login is free to call and unauthenticated, so without a
 * counter of its own it is an unlimited guessing oracle against every account that
 * has a password.
 *
 * Keyed on the caller (an HMAC of their address), not on the account. Keying on the
 * account would let anybody lock a specific person out by guessing at their number
 * repeatedly, which converts a brute-force defence into a denial-of-service tool.
 * The trade is that a shared address shares a budget, which is why the ceiling is
 * generous enough for a household or an office rather than tuned to one person.
 */

/** Attempts allowed from one caller per window. */
const MAX_ATTEMPTS_PER_WINDOW = 20;

/**
 * Attempts allowed against one account per window, counted separately.
 *
 * The caller axis above is keyed on the leftmost `x-forwarded-for`, which the caller
 * supplies — rotating that header rotates the key and resets the budget. For SMS
 * that is tolerable because per-number ceilings sit underneath it; password login
 * has no such floor, so a caller axis alone leaves the guessing space unbounded.
 * This is the axis the caller cannot choose.
 *
 * Deliberately *not* a lockout. Exceeding it refuses this attempt, but the counter
 * is keyed on a hash of the number rather than on the account row, and it never
 * writes to the account — so it slows guessing without giving anyone a way to bar a
 * victim from their own login permanently. The window simply passes.
 */
const MAX_ATTEMPTS_PER_ACCOUNT = 10;

/** The window, long enough that grinding is impractical and short enough to forgive typos. */
const WINDOW_MS = 1000 * 60 * 15;

/** Raised when the caller has spent their budget. Carries the user-facing message. */
export class PasswordAttemptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordAttemptError";
  }
}

/**
 * Records one attempt and throws when the budget is spent.
 *
 * Writes before checking rather than after, so a caller cannot spend attempts
 * without them being counted — and so concurrent requests cannot all read the same
 * pre-increment total and each be granted a guess, which is the check-then-act race
 * that would turn a 20-guess budget into an unbounded one.
 *
 * A null key (no address available, as in local development) skips the budget
 * rather than failing closed: an absent platform header must not make signing in
 * impossible, and a caller who can suppress it gains nothing the guessing space
 * does not already give them.
 */
export async function countPasswordAttempt(
  senderKey: string | null,
): Promise<void> {
  if (!senderKey) return;
  await countAttemptOn(senderKey, MAX_ATTEMPTS_PER_WINDOW);
}

/**
 * Records one attempt against a specific number and throws when that number's
 * budget is spent.
 *
 * Called with the blind index rather than the number, and prefixed so it cannot
 * collide with a caller key. Must be called for numbers with no account too —
 * skipping it when the lookup misses would make the *presence* of rate limiting an
 * oracle for which numbers are registered, which is exactly what the login route's
 * single generic failure exists to prevent.
 */
export async function countAccountAttempt(phoneHash: string): Promise<void> {
  await countAttemptOn(`account:${phoneHash}`, MAX_ATTEMPTS_PER_ACCOUNT);
}

/**
 * Shared counter. Writes before checking rather than after, so a caller cannot spend
 * attempts without them being counted — and so concurrent requests cannot all read
 * the same pre-increment total and each be granted a guess, which is the
 * check-then-act race that would turn a finite budget into an unbounded one.
 *
 * `>=` against the count *including* the row just written, so `max` is the number of
 * attempts allowed rather than one less than it.
 */
async function countAttemptOn(key: string, max: number): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  // Swept opportunistically here rather than by a scheduled job. Rows outside the
  // window can never affect a count again, and this table takes a write on every
  // login attempt in the system — leaving them would be unbounded growth driven by
  // unauthenticated traffic. Scoped to this key so the delete stays on the index
  // and one caller's cleanup cannot be made to scan another's rows.
  await prisma.passwordAttempt.deleteMany({
    where: { senderKey: key, createdAt: { lte: windowStart } },
  });

  await prisma.passwordAttempt.create({
    data: { senderKey: key, createdAt: now },
  });

  const recent = await prisma.passwordAttempt.count({
    where: { senderKey: key, createdAt: { gt: windowStart } },
  });

  if (recent > max) {
    throw new PasswordAttemptError(
      "로그인 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

/**
 * Forgets a caller's and an account's failed attempts after a successful sign-in.
 *
 * Without this the budget counts successes too, so a household or an office behind
 * one address — and on a carrier CGNAT, thousands of strangers — would share a
 * 20-per-15-minutes allowance for *ordinary logins*, not just for guessing. Only
 * failures should accumulate; a correct password is evidence the caller is not
 * grinding.
 */
export async function clearPasswordAttempts(
  senderKey: string | null,
  phoneHash: string,
): Promise<void> {
  const keys = [`account:${phoneHash}`, ...(senderKey ? [senderKey] : [])];
  await prisma.passwordAttempt.deleteMany({
    where: { senderKey: { in: keys } },
  });
}
