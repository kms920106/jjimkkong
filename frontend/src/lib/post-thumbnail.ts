import { Platform } from "@/generated/prisma/enums";
import {
  INSTAGRAM_CDN_HOSTS,
  fetchAndPutImage,
  isOwnBlobUnder,
  type BackupSpec,
} from "@/lib/cdn-image-backup";
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
 * The fetch-sniff-store step itself lives in lib/cdn-image-backup.ts, shared
 * with the author avatars that expire for the same reason. This file keeps what
 * is specific to thumbnails: the size cap, the prefix, and the delete path with
 * its reference count.
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
 * profile pictures and author avatars sharing the same store, and that check is
 * what gates the delete. Changing it orphans every blob written under the old
 * prefix.
 */
const BLOB_PREFIX = "post-thumbnail";

/**
 * Shorter than the ingest route's own budget. The thumbnail is a nice-to-have
 * inside a request that has already spent time on metadata, the model and
 * geocoding, so it must not be what pushes the whole save past maxDuration.
 */
const FETCH_TIMEOUT_MS = 6_000;

const SPEC: BackupSpec = {
  logTag: "ingest:thumbnail",
  prefix: BLOB_PREFIX,
  basename: "thumb",
  allowedHosts: INSTAGRAM_CDN_HOSTS,
  maxBytes: MAX_THUMBNAIL_BYTES,
  timeoutMs: FETCH_TIMEOUT_MS,
};

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
  return fetchAndPutImage(cdnUrl, SPEC);
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
 * an arbitrary host, or the `profile/` and `post-author/` prefixes in the same
 * store, where a mistaken delete would take out somebody's avatar.
 */
export function isOwnThumbnailBlob(url: string | null): boolean {
  return isOwnBlobUnder(url, BLOB_PREFIX);
}

// `deleteThumbnailBlob()` used to live here and is gone, along with the
// reference counting that guarded it. Both existed because `thumbnail` was a
// per-member column written from a request body: a save could displace a blob,
// and blob URLs are public, so a caller could point their own row at someone
// else's thumbnail and have the next save remove it. Counting the rows that
// still referenced a URL was the ownership check that made that a no-op.
//
// The column moved to the shared `Post`, which is written once and never
// updated. Nothing displaces a blob any more, and un-bookmarking must not touch
// one — the picture belongs to a post other members may still have saved. There
// is no delete path left to guard, so there is no delete path.
//
// Do not add one back without re-adding the count. The attack it blocked is a
// property of blob URLs being public, not of the old schema.
