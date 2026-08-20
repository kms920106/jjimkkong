import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "./password-policy";

// Re-exported so server-side callers have one import for the whole password API.
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH };

/**
 * Password hashing, on Node's built-in scrypt.
 *
 * No new dependency for the same reason phone-crypto.ts builds on node:crypto:
 * this codebase already owns its primitives, and scrypt is a real password KDF —
 * memory-hard, so it resists the GPU arrays that make a plain SHA-256 of a
 * password worthless. It is not a general-purpose hash used as one.
 */

/** Cost parameters. N is the memory/CPU cost; raising it later is why the format is versioned. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * `s1.<salt>.<derived>`, base64url.
 *
 * The salt is stored beside the hash because it must be recovered to verify, and
 * it is not a secret — its job is to make two identical passwords hash
 * differently, so a stolen table cannot be attacked once for all rows. The `s1`
 * prefix is what allows the cost parameters to be raised later: a stored `s1`
 * hash still verifies under the old cost while new writes use the new one.
 * Do not strip it.
 */
const PREFIX = "s1";


/**
 * Promise wrapper around scrypt, written by hand rather than via promisify().
 *
 * A typing problem, not a runtime one — be precise about which, because the
 * difference matters if anyone revisits this. `promisify(scrypt)` forwards the
 * options object correctly at runtime (measured: N=1024 takes ~3ms against
 * N=16384's ~42ms, so the cost parameters do take effect). What it does not do is
 * type-check them: promisify's overload resolution picks scrypt's 3-argument
 * signature, so passing `{N, r, p}` is a compile error ("Expected 3 arguments, but
 * got 4"). Writing the callback out keeps the cost parameters both applied and
 * type-checked against ScryptOptions.
 */
function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

/** Raised for a password the user can fix by typing a different one. */
export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

/**
 * Checks length only — no character-class rules.
 *
 * Deliberate, and the current NIST guidance: composition rules ("one symbol, one
 * capital") push people toward `Password1!` and toward reusing the one string
 * that satisfies every site, which is worse than a long passphrase they can
 * remember. Length is the property that actually costs an attacker.
 */
export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `비밀번호는 ${MAX_PASSWORD_LENGTH}자 이하여야 합니다.`,
    );
  }
}

/** Derives the stored verifier for a new or changed password. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  const salt = randomBytes(SALT_LENGTH);
  const derived = await derive(password, salt, KEY_LENGTH);
  return [
    PREFIX,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join(".");
}

/**
 * Compares a submitted password against a stored verifier.
 *
 * Returns false rather than throwing for every failure — a malformed stored hash,
 * an unknown version prefix, a wrong password — because the caller must not be
 * able to tell those apart, and neither must the user. `timingSafeEqual` for the
 * final comparison: a plain `===` returns as soon as two bytes differ, which
 * leaks how much of the derived key matched.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "base64url");
    expected = Buffer.from(parts[2], "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  // Bounded before scrypt runs: verification must not become a lever for making
  // the server chew on a megabyte-long submission.
  if (password.length > MAX_PASSWORD_LENGTH) return false;

  const derived = await derive(password, salt, expected.length);

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Burns roughly the same work as a real verification, for a number that has no
 * account or no password.
 *
 * Without this, "no such account" answers in microseconds while a real password
 * check takes scrypt's full cost, and that difference is a membership oracle
 * measurable over the network — it would undo the equal error messages the login
 * route is careful to return. The salt is fresh each call because the value is
 * discarded; only the elapsed time matters.
 */
export async function burnPasswordComparison(password: string): Promise<void> {
  const bounded = password.slice(0, MAX_PASSWORD_LENGTH);
  // KEY_LENGTH, matching what hashPassword() writes and therefore what
  // verifyPassword() derives for any real stored hash. If the versioned format ever
  // stores a different length, these two must be changed together or the burn stops
  // costing the same as the comparison it is standing in for.
  await derive(bounded, randomBytes(SALT_LENGTH), KEY_LENGTH);
}
