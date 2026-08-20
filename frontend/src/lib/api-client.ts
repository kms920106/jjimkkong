/**
 * Reads the Korean error message out of a failed API response.
 *
 * Every route funnels its failures through `toErrorResponse()`, which puts a
 * user-facing Korean string in `error`. The fallback covers the responses that
 * never reached it — a proxy's HTML error page, a network-truncated body — where
 * `response.json()` throws rather than returning something to read.
 */
export async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}
