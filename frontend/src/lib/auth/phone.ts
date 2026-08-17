/**
 * Korean mobile numbers, normalized to bare local digits (`01012345678`).
 *
 * Every provider hands phone numbers over in a different shape — Naver sends
 * `010-1234-5678`, Kakao sends `+82 10-1234-5678`, and a user typing into the
 * SMS form sends anything at all. The number is the key accounts merge on, so
 * all of those have to collapse to one string or the same person ends up with
 * two accounts.
 *
 * The stored form is the local one rather than E.164 because that is the shape
 * the number is entered, displayed, and handed to Solapi in. E.164 bought
 * nothing here — there is exactly one country in play, so the `+82` was a
 * constant prefix that every consumer stripped again.
 */

/**
 * A Korean mobile number as bare local digits, e.g. `01012345678`.
 *
 * Branded so an arbitrary string cannot reach it. The brand is what keeps
 * `blindIndex()` honest: it is a plain HMAC, so an un-normalized input produces
 * a hash that matches nothing and fails as a silent lookup miss rather than an
 * error. Everything that stores or looks up a number goes through
 * `normalizeKoreanMobile()` to get one of these.
 */
export type LocalMobile = string & { readonly __localMobile: unique symbol };

/**
 * Returns the local-digit form, or null when the input is not a Korean mobile
 * number. Null means "do not use this for account matching" — never fall back
 * to the raw string, since that would let `010-1234-5678` and `01012345678`
 * become two different accounts for one person.
 */
export function normalizeKoreanMobile(
  input: string | null | undefined,
): LocalMobile | null {
  if (!input) return null;

  // Strip everything the formats disagree about: spaces, dashes, parens, and
  // the `+`. What's left is digits, which the country-code cases below reduce
  // to a national number.
  const digits = input.replace(/[^\d]/g, "");
  if (digits.length === 0) return null;

  let national: string;
  if (digits.startsWith("82")) {
    // +82 10 1234 5678 — the national trunk `0` is dropped in international
    // format, but some providers include it anyway (`+82 010 …`).
    national = `0${digits.slice(2).replace(/^0/, "")}`;
  } else if (digits.startsWith("0")) {
    national = digits;
  } else {
    // A bare `1012345678` is the national number with its leading 0 lost.
    national = `0${digits}`;
  }

  // Mobile prefixes only; landlines (02, 031, …) are rejected because they
  // cannot receive the verification SMS.
  //
  // The two lengths are not interchangeable: 010 numbers are always 11 digits,
  // while the legacy carriers (011/016/017/018/019) are 10 or 11. Accepting
  // `\d{7,8}` for both would let a 10-digit 010 number through — one digit
  // short of any real number, and it would then occupy the live-unique slot
  // that accounts are merged on.
  if (!/^(010\d{8}|01[16789]\d{7,8})$/.test(national)) return null;

  return national as LocalMobile;
}

/** `01012345678` → `010-1234-5678`, for display back to the user. */
export function formatKoreanMobile(local: string): string {
  const match = /^(01[016789])(\d{3,4})(\d{4})$/.exec(local);
  if (!match) return local;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** `01012345678` → `010-****-5678`, for confirmation screens. */
export function maskKoreanMobile(local: string): string {
  const formatted = formatKoreanMobile(local);
  const parts = formatted.split("-");
  if (parts.length !== 3) return formatted;
  return `${parts[0]}-${"*".repeat(parts[1].length)}-${parts[2]}`;
}
