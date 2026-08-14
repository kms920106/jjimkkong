/**
 * Local-only stand-in for a Supabase session, so the app can be exercised
 * before the Google/Kakao OAuth apps exist.
 *
 * Gated on the build being non-production: in a production bundle
 * `devLoginEnabled()` is constant-false, so every call site is a dead branch
 * and /api/dev-login 404s.
 *
 * This module holds no `next/headers` import so the proxy (Edge runtime) can
 * use it too; cookie reads live at the call sites.
 */
export const DEV_SESSION_COOKIE = "jjimkkong-dev-session";

/** Fixed uuid so the profile and its posts survive across restarts. */
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_USER_EMAIL = "test@jjimkkong.local";

export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Whether a cookie value identifies the dev session. */
export function isDevSessionValue(value: string | undefined): boolean {
  return devLoginEnabled() && value === DEV_USER_ID;
}
