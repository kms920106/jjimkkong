import { del, put } from "@vercel/blob";
import { Platform } from "@/generated/prisma/enums";
import {
  IMAGE_EXTENSIONS,
  IMAGE_SNIFF_BYTES,
  sniffImageType,
} from "@/lib/image-bytes";
import type { PostMetadata } from "@/lib/ingest/metadata";

/**
 * Copying Instagram thumbnails onto our own blob store, because theirs expire.
 *
 * `scontent-*.cdninstagram.com` URLs are time-limited signed URLs — the `oh`,
 * `oe` and `_nc_ohc` query parameters are a signature and its expiry. The
 * ingest pipeline reads one out of og:image or the embed page and stores the
 * string, so a thumbnail that rendered on the day it was saved comes back
 * `403 URL signature expired` days later and every card in /links shows a
 * broken image. Copying the bytes at ingest time is the only fix that survives:
 * re-fetching the same URL later cannot re-sign it.
 *
 * Only Instagram needs this. YouTube (`i.ytimg.com`) and the Naver/Kakao map
 * og:image URLs carry no signature and stay valid indefinitely, so they are
 * left pointing at the platform CDN — backing them up would spend storage and
 * egress to solve a problem they do not have.
 *
 * ## This module never throws
 *
 * The opposite contract to lib/profile-image.ts, and that difference is why the
 * two are separate files. A profile picture upload is the action the user asked
 * for, so a failure should surface as a 400. A thumbnail backup is work the
 * user never requested. Failing a link save because `BLOB_READ_WRITE_TOKEN` is
 * missing — which is the normal state of a local dev checkout — would let one
 * deployment gap stop the whole product. Storing a URL that will expire is
 * always better than storing nothing at all.
 *
 * So there is no error class here and no branch in lib/api.ts. Every failure
 * ends as a log line and the original CDN URL is kept.
 */

/**
 * 2MB. Instagram og:image files measure 100-300KB in practice, and a 1080px
 * JPEG tops out near 1MB — this is six times the normal range, so it never cuts
 * real traffic and only bounds what an unexpected response can cost us.
 *
 * Deliberately not MAX_UPLOAD_BYTES (6MB). That number is sized for an
 * unresized phone camera photo; this one is sized for an image a CDN already
 * serves to browsers. Same storage, different premise.
 */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

/**
 * Path prefix every thumbnail blob is stored under. Load-bearing, not cosmetic:
 * {@link isOwnThumbnailBlob} uses it to tell our thumbnails apart from the
 * profile pictures sharing the same store, and that check is what gates the
 * delete. Changing it orphans every blob written under the old prefix.
 */
const BLOB_PREFIX = "post-thumbnail";

/**
 * Shorter than the ingest route's own budget. The thumbnail is a nice-to-have
 * inside a request that has already spent time on metadata, the model and
 * geocoding, so it must not be what pushes the whole save past maxDuration.
 */
const FETCH_TIMEOUT_MS = 6_000;

/**
 * Hosts we will fetch thumbnail bytes from.
 *
 * The URL is not user input — the server parsed it out of Instagram's own HTML
 * moments earlier, which is the entire reason the backup happens at ingest time
 * rather than at save time (a URL from the request body would make this an SSRF
 * sink). But it is still a string Instagram chose, so the host is pinned rather
 * than trusted.
 */
const ALLOWED_HOSTS = [/^scontent[\w.-]*\.cdninstagram\.com$/, /\.fbcdn\.net$/];

/**
 * Why a backup did not happen. Kept as distinct values for the same reason
 * metadata.ts keeps FailureReason distinct: "we have no token" and "Instagram
 * is blocking us" call for opposite responses, and one collapsed warning tells
 * the next reader neither.
 */
type BackupFailure =
  // No BLOB_READ_WRITE_TOKEN. The normal state of a local checkout, not an
  // incident — logged at info level so it does not pollute the warn stream.
  | "no_token"
  | "unsupported_host"
  | "fetch_timeout"
  | "network"
  | "http_error"
  // A 3xx from the CDN. Not followed: see the fetch call below.
  | "redirected"
  | "too_large"
  // The bytes are not one of the formats we are willing to serve.
  | "unsupported_type"
  // The upload itself failed — quota, network to Blob, a revoked token.
  | "blob_error"
  | "unknown";

function logFailure(
  reason: BackupFailure,
  sourceUrl: string,
  context: Record<string, string | number | undefined> = {},
) {
  const details = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const line =
    `[ingest:thumbnail] backup skipped reason=${reason}` +
    `${details ? ` ${details}` : ""} url=${sourceUrl}`;

  // A missing token is a deployment fact, not a failure to investigate.
  if (reason === "no_token") console.info(line);
  else console.warn(line);
}

function isAllowedHost(url: URL): boolean {
  return ALLOWED_HOSTS.some((pattern) => pattern.test(url.hostname));
}

/**
 * Downloads `cdnUrl` and stores it as a public blob, returning its URL — or
 * null if anything at all went wrong.
 *
 * Exported for the backfill script, which needs the same fetch-and-store step
 * for rows saved before this existed but reaches it with a URL it just
 * re-scraped rather than a PostMetadata.
 */
export async function fetchAndPutThumbnail(
  cdnUrl: string,
): Promise<string | null> {
  // Checked before the fetch so a tokenless environment never touches the
  // Instagram CDN for bytes it cannot store anyway.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    logFailure("no_token", cdnUrl);
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(cdnUrl);
  } catch {
    logFailure("unsupported_host", cdnUrl);
    return null;
  }
  if (parsed.protocol !== "https:" || !isAllowedHost(parsed)) {
    logFailure("unsupported_host", cdnUrl, { host: parsed.hostname });
    return null;
  }

  try {
    const res = await fetch(cdnUrl, {
      // Not "follow". A redirect would move the request off the host the
      // allowlist just checked, leaving the check applied to the first hop
      // only. Instagram's CDN answers directly, so there is nothing to follow.
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (res.status >= 300 && res.status < 400) {
      logFailure("redirected", cdnUrl, {
        status: res.status,
        location: res.headers.get("location") ?? undefined,
      });
      return null;
    }
    if (!res.ok) {
      // 403 here means the signature had already expired by the time we tried,
      // which happens when Instagram hands out a very short-lived URL.
      logFailure("http_error", cdnUrl, { status: res.status });
      return null;
    }

    // Cheap rejection first: if the CDN tells us it is oversized, stop before
    // reading a body we would only discard. Written as an explicit
    // header-present test because Number(null) is 0, which would silently read
    // as "well within the cap" rather than "no answer".
    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > MAX_THUMBNAIL_BYTES) {
      logFailure("too_large", cdnUrl, { declaredBytes: declared });
      return null;
    }

    // The header above may be absent or lying, so the real length decides. Note
    // this buffers the whole body first: the cap is enforced after the transfer,
    // not during it. Acceptable because the allowlist means only Meta's CDN is
    // ever on the other end; a genuinely hostile host on that list could make
    // us buffer more than the cap once, which is why the host check comes first.
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
      logFailure("too_large", cdnUrl, { bytes: bytes.byteLength });
      return null;
    }

    // The bytes decide the type. Instagram's Content-Type header is a claim by
    // the CDN, and comparing it against the sniff would buy nothing — what we
    // store as `contentType` is the sniff result either way. The check that
    // matters is that bytes we are about to serve publicly really are one of
    // the formats on the allowlist, which is what keeps an SVG (a script
    // carrier on the blob origin) out.
    const sniffed = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
    if (!sniffed) {
      logFailure("unsupported_type", cdnUrl, { bytes: bytes.byteLength });
      return null;
    }
    const extension = IMAGE_EXTENSIONS.get(sniffed)!;

    // Not resized. There is no image library in this project, and adding one
    // would weigh down the bundle and the build to save bandwidth on a 64px
    // render. The cost of shipping the original is a few hundred KB; the cost
    // being paid today is a broken image. `loading="lazy"` keeps offscreen
    // cards from requesting it at all, and the blob CDN serves it immutable so
    // a revisit transfers nothing. Keeping the original bytes also leaves
    // resizing available later.
    // Wrapped in a Blob because put() takes no bare Uint8Array. Its own type
    // is left unset — `contentType` below is what Blob stores and serves.
    //
    // `thumb.<ext>` rather than a name derived from the post: the key must not
    // encode anything, since addRandomSuffix is what makes each URL unique.
    // The extension is a suffix so the stored object is self-describing in the
    // Blob dashboard and the URL ends the way consumers expect.
    const blob = await put(`${BLOB_PREFIX}/thumb.${extension}`, new Blob([bytes]), {
      access: "public",
      // A random suffix, never a key derived from the post. A stable key would
      // be overwritten in place and the blob CDN would keep serving the old
      // bytes under the unchanged URL — the same trap profile pictures hit.
      addRandomSuffix: true,
      contentType: sniffed,
    });
    return blob.url;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "TimeoutError") {
      logFailure("fetch_timeout", cdnUrl, { timeoutMs: FETCH_TIMEOUT_MS });
      return null;
    }
    if (cause instanceof Error) {
      // `fetch` reports transport faults as TypeError; anything else here came
      // from the Blob SDK (a missing store, a revoked token, a quota).
      const reason = cause.name === "TypeError" ? "network" : "blob_error";
      logFailure(reason, cdnUrl, {
        errorName: cause.name,
        errorMessage: cause.message,
      });
      return null;
    }
    logFailure("unknown", cdnUrl, { errorMessage: String(cause) });
    return null;
  }
}

/**
 * Returns `metadata` with its Instagram thumbnail replaced by a backed-up blob
 * URL, or unchanged if there is nothing to back up or the backup failed.
 *
 * Takes and returns the whole PostMetadata so the platform test, the null test
 * and the fallback all live here — the ingest route calls this once and carries
 * no branch of its own.
 *
 * On success `thumbnail` points at our blob and `thumbnailSource` holds the
 * original CDN URL. That pairing is deliberate: `thumbnail` stays "the URL to
 * render" for every consumer, and a non-null `thumbnailSource` is what tells a
 * later reader the row was backed up.
 */
export async function backupThumbnail(
  metadata: PostMetadata,
): Promise<PostMetadata> {
  if (metadata.platform !== Platform.INSTAGRAM || !metadata.thumbnail) {
    return metadata;
  }

  const stored = await fetchAndPutThumbnail(metadata.thumbnail);
  if (!stored) return metadata;

  return { ...metadata, thumbnail: stored, thumbnailSource: metadata.thumbnail };
}

/**
 * Whether `url` looks like a post thumbnail stored in our own blob store.
 *
 * **Necessary but not sufficient for deleting it.** This answers "is this one of
 * our thumbnails", not "is this one *this user's* thumbnails" — and the URL
 * cannot answer the second question, because thumbnail URLs are public: they go
 * out in SavedPostDTO, and GET /api/places/[id]/sources serves every user's
 * posts unauthenticated. A signed-in caller can therefore save someone else's
 * thumbnail URL onto their own post. Every caller pairs this with a count of how
 * many rows still reference the URL, and deletes only at zero; that count is the
 * actual ownership check. Do not delete on this predicate alone.
 *
 * What this does rule out is a URL pointing anywhere other than our thumbnails —
 * an arbitrary host, or the `profile/` prefix in the same store, where a
 * mistaken delete would take out somebody's avatar.
 *
 * The host is matched against the shape Blob actually serves from,
 * `<store>.public.blob.vercel-storage.com`. Matching the broader
 * `.blob.vercel-storage.com` would also accept another Vercel customer's store
 * host, which is not ours to reason about.
 */
export function isOwnThumbnailBlob(url: string | null): boolean {
  if (!url) return false;
  try {
    const { protocol, hostname, pathname } = new URL(url);
    // `new URL()` normalises the path before this reads it, so `..` segments
    // and percent-encoded separators are already resolved — a traversal out of
    // the prefix fails the startsWith rather than sneaking past it.
    const prefix = `/${BLOB_PREFIX}/`;
    return (
      protocol === "https:" &&
      hostname.endsWith(".public.blob.vercel-storage.com") &&
      pathname.startsWith(prefix) &&
      // The directory itself names no object.
      pathname.length > prefix.length
    );
  } catch {
    return false;
  }
}

/**
 * Deletes a thumbnail blob that nothing references any more, ignoring failures.
 *
 * Best effort for the same reason deleteProfileImage() is: the row has already
 * been written, so a failed delete leaks a blob but never breaks a save. Only
 * ever called with a URL read back out of the row being replaced or removed —
 * never with a value from a request body, which is what keeps it from being
 * aimed at another user's blob.
 */
export async function deleteThumbnailBlob(url: string | null): Promise<void> {
  if (!url) return;
  try {
    await del(url);
  } catch (error) {
    console.error("Failed to delete superseded post thumbnail:", error);
  }
}
