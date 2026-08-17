import {
  createDecipheriv,
  createCipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { maskKoreanMobile, type LocalMobile } from "./phone";

/**
 * Encryption at rest for phone numbers.
 *
 * The number is the key accounts merge on, so it has to support two operations
 * that pull in opposite directions: equality lookup (does a live profile
 * already hold this number?) and recovery (show the user which number is on
 * their account). Authenticated encryption with a random IV gives recovery but
 * not lookup — the same number encrypts to a different string every time, which
 * would break both the partial unique index and every `findFirst({ phone })`.
 *
 * So each number is stored twice, in two columns that always move together:
 *
 *   phoneHash  HMAC-SHA256, deterministic. Carries the unique index and every
 *              lookup. Same number always yields the same value.
 *   phoneEnc   AES-256-GCM with a random IV. Decrypts back to `01012345678`.
 *              Never queried.
 *
 * This is the standard "blind index + envelope" shape. The tradeoff it accepts:
 * phoneHash leaks equality. Anyone with the table can tell that two rows hold
 * the same number, and anyone with the table *and* the HMAC key can confirm a
 * guessed number (the space of Korean mobiles is ~10^8, trivially enumerable —
 * the HMAC key is the only thing standing in the way, which is why it must not
 * live in the database).
 */

/** Both stored forms of one number. Written and cleared as a unit. */
export type EncryptedPhone = {
  hash: string;
  enc: string;
};

/**
 * Version tag on both columns.
 *
 * On phoneEnc it selects the decryption key. On phoneHash it is what makes an
 * HMAC key rotation possible at all: rotating changes every hash, and without a
 * generation marker there is no way to tell a not-yet-rehashed row from a row
 * holding a different number. Rotation is not implemented — see the note at the
 * bottom of this file — but the marker has to be in the data from the first
 * write or it can never be added.
 */
const VERSION = "v1";

/** HKDF info labels. Distinct so the two subkeys are cryptographically independent. */
const HMAC_INFO = "jjimkkong:phone:blind-index:v1";
const AES_INFO = "jjimkkong:phone:aead:v1";

/** AES-GCM standard nonce length. */
const IV_BYTES = 12;

let cached: { hmacKey: Buffer; aesKey: Buffer } | null = null;

/**
 * Derives both subkeys from PHONE_ENCRYPTION_KEY.
 *
 * Separate from AUTH_SECRET on purpose: AUTH_SECRET signs short-lived login
 * cookies and rotating it costs nothing but in-flight logins, while rotating
 * this one requires re-encrypting every row. Sharing one secret between the two
 * would tie the cheap rotation to the expensive one.
 *
 * The env var is base64 or hex of 32 raw bytes, and it is the *decoded byte
 * length* that is checked. A 32-character check would pass for a 32-character
 * password carrying nowhere near 32 bytes of entropy, and this key is the only
 * thing making the blind index resistant to enumerating the whole Korean mobile
 * number space.
 */
function keys(): { hmacKey: Buffer; aesKey: Buffer } {
  if (cached) return cached;

  const raw = process.env.PHONE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "PHONE_ENCRYPTION_KEY가 설정되지 않았습니다. (base64 또는 hex로 인코딩된 32바이트)",
    );
  }

  const decoded = decodeKey(raw);
  if (decoded.length < 32) {
    throw new Error(
      "PHONE_ENCRYPTION_KEY가 너무 짧습니다. 32바이트 이상이 필요합니다: openssl rand -base64 32",
    );
  }

  cached = {
    hmacKey: derive(decoded, HMAC_INFO),
    aesKey: derive(decoded, AES_INFO),
  };
  return cached;
}

/**
 * Reads the key as hex when it looks like hex, base64 otherwise.
 *
 * Buffer.from(s, "base64") never throws — it silently skips characters outside
 * the alphabet — so a hex key read as base64 would decode to a shorter buffer
 * rather than an error, and would still pass a length check while using only
 * part of the entropy. Checking the hex shape first avoids that.
 */
function decodeKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, "hex");
  }
  return Buffer.from(trimmed, "base64");
}

function derive(secret: Buffer, info: string): Buffer {
  // No salt: the input is already a full-entropy random key rather than a
  // password, so HKDF is being used here purely for domain separation.
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), info, 32));
}

/**
 * The deterministic lookup value for a number.
 *
 * Takes the local form (`01012345678`) — the same normalized string that is
 * encrypted — so the hash and the ciphertext can never describe different
 * numbers. Feeding a differently-normalized string in (E.164, or with hyphens)
 * produces a hash that matches nothing, and the failure is a silent lookup miss
 * rather than an error, which is why `LocalMobile` is a branded type.
 */
export function blindIndex(local: LocalMobile): string {
  const { hmacKey } = keys();
  const digest = createHmac("sha256", hmacKey).update(local).digest("hex");
  return `${VERSION}:${digest}`;
}

/** AES-256-GCM. Output is `v1.iv.tag.ciphertext`, all base64url. */
export function encryptPhone(local: LocalMobile): string {
  const { aesKey } = keys();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(local, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Both stored forms of a number, for writing a profile row.
 *
 * One function rather than two calls at each site so the two columns cannot be
 * written from different inputs.
 */
export function sealPhone(local: LocalMobile): EncryptedPhone {
  return { hash: blindIndex(local), enc: encryptPhone(local) };
}

/**
 * Recovers `01012345678`, or null when the value cannot be authenticated.
 *
 * Null rather than throwing: a row written under a rotated-away key, or a
 * corrupted one, must not turn a page render into a 500. Callers that only want
 * to show the number treat null as "unknown"; nothing authenticates on this.
 */
export function decryptPhone(value: string | null | undefined): string | null {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const [version, iv, tag, ciphertext] = parts;
  if (version !== VERSION) return null;

  try {
    const { aesKey } = keys();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      aesKey,
      Buffer.from(iv, "base64url"),
    );
    // Set before final(): this is what makes the read authenticated. Without it
    // GCM degenerates to CTR and a tampered ciphertext decrypts to attacker-
    // chosen bytes instead of failing.
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    // final() throws on tag mismatch. Indistinguishable here from a wrong key,
    // and both mean the same thing to the caller: this value is not readable.
    return null;
  }
}

/**
 * The masked number for a profile row, or null when there is nothing to show.
 *
 * The one place the ciphertext is read back. Masked here, on the server, so the
 * full number never enters a client payload — the browser has no use for it,
 * and the account page only ever needs to confirm *which* number is on file.
 */
export function maskedPhoneOf(
  profile: { phoneEnc: string | null },
): string | null {
  const local = decryptPhone(profile.phoneEnc);
  return local ? maskKoreanMobile(local) : null;
}

/**
 * Key rotation is not implemented.
 *
 * Rotating the AES half is cheap in principle (decrypt with the old key,
 * re-encrypt with the new one, one row at a time). Rotating the HMAC half is
 * not: every phoneHash changes, and while both generations are present the
 * partial unique index stops preventing duplicates, because one person's old
 * and new hashes are different values and the index sees two distinct live
 * rows — which is exactly the account-merge invariant the index exists to hold.
 *
 * Doing it safely means adding the new-generation hash as a second column,
 * backfilling it, and only then swapping the index — the same shape as the
 * migration that introduced these columns. The `v1` markers above exist so that
 * is possible later; do not strip them.
 */
