/**
 * Korean mobile numbers, normalized to E.164 (+8210…).
 *
 * Every provider hands phone numbers over in a different shape — Naver sends
 * `010-1234-5678`, Kakao sends `+82 10-1234-5678`, and a user typing into the
 * SMS form sends anything at all. UserProfile.phone is a unique column and the
 * key accounts merge on, so all of those have to collapse to one string or the
 * same person ends up with two accounts.
 */

/** A Korean mobile number in E.164, e.g. `+821012345678`. */
export type E164 = string;

/**
 * Returns the E.164 form, or null when the input is not a Korean mobile
 * number. Null means "do not use this for account matching" — never fall back
 * to the raw string, since that would let `010-1234-5678` and `+821012345678`
 * become two different accounts for one person.
 */
export function normalizeKoreanMobile(input: string | null | undefined): E164 | null {
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
  // short of any real number, and it would then occupy the unique `phone`
  // column that accounts are merged on.
  if (!/^(010\d{8}|01[16789]\d{7,8})$/.test(national)) return null;

  return `+82${national.slice(1)}`;
}

/** `+821012345678` → `010-1234-5678`, for display back to the user. */
export function formatKoreanMobile(e164: E164): string {
  const national = `0${e164.replace(/^\+82/, "")}`;
  const match = /^(01[016789])(\d{3,4})(\d{4})$/.exec(national);
  if (!match) return e164;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** `010-1234-5678` → `010-****-5678`, for confirmation screens. */
export function maskKoreanMobile(e164: E164): string {
  const formatted = formatKoreanMobile(e164);
  const parts = formatted.split("-");
  if (parts.length !== 3) return formatted;
  return `${parts[0]}-${"*".repeat(parts[1].length)}-${parts[2]}`;
}
