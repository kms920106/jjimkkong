import { Platform } from "@/generated/prisma/enums";

/**
 * The author's profile on the platform they posted from, or null when we
 * cannot build one.
 *
 * Null is the common case and not a failure. Only Instagram stores something
 * addressable: its `author` is the handle, parsed out of the permalink, and
 * `instagram.com/<handle>/` is that account. YouTube's `author` is the channel
 * *title* rather than its id or its `@handle` — the Data API's `channelTitle`
 * and oEmbed's `author_name` are both display strings — and guessing a URL
 * from a display name lands on the wrong channel or a 404. The map platforms
 * have no author at all.
 *
 * Returning null rather than a search URL is deliberate: a link that sometimes
 * lands on the person and sometimes on a list of unrelated results is worse
 * than no link, because the user cannot tell which they got.
 */
export function authorProfileUrl(
  author: string,
  platform: Platform,
): string | null {
  if (platform !== Platform.INSTAGRAM) return null;

  // Instagram handles are `[A-Za-z0-9._]`, but this string came off a page we
  // parsed rather than a schema we control, so anything with a path separator
  // or whitespace in it is not a handle and must not be pasted into a URL.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(author)) return null;

  return `https://www.instagram.com/${author}/`;
}
