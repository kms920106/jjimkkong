/**
 * The password length rules, in their own module with no node:crypto import.
 *
 * Split out from password.ts so client components can state the rule in the UI
 * without pulling a server-only crypto module into the browser bundle. Bundlers do
 * tree-shake the unused parts today, but that is an optimization, not a boundary —
 * and this rule genuinely belongs to both sides: the form disables its button on it
 * and the server enforces it.
 */

/** OWASP's floor, and the shortest thing worth calling a password. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Upper bound, because scrypt runs over whatever it is given and an unbounded
 * password is a free way to make the server do arbitrary work per request.
 */
export const MAX_PASSWORD_LENGTH = 128;
