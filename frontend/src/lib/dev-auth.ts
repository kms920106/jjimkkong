/**
 * Stand-in for a Supabase session, so the app can be exercised before the
 * Google/Kakao OAuth apps exist. Unconditionally enabled — including in
 * `next build`/`next start` — since OAuth isn't wired up in any environment
 * this app runs in yet. Revisit this once real OAuth ships: an unauthenticated
 * caller can currently sign in as this fixed uuid via /api/dev-login.
 *
 * This module holds no `next/headers` import so the proxy (Edge runtime) can
 * use it too; cookie reads live at the call sites.
 */
export const DEV_SESSION_COOKIE = "jjimkkong-dev-session";

/** Fixed uuid so the profile and its posts survive across restarts. */
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_USER_EMAIL = "test@jjimkkong.local";

/** Whether a cookie value identifies the dev session. */
export function isDevSessionValue(value: string | undefined): boolean {
  return value === DEV_USER_ID;
}
