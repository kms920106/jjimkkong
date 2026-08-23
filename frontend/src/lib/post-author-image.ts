import { Platform } from "@/generated/prisma/enums";
import {
  INSTAGRAM_CDN_HOSTS,
  fetchAndPutImage,
  isOwnBlobUnder,
  type BackupSpec,
} from "@/lib/cdn-image-backup";
import type { PostMetadata } from "@/lib/ingest/metadata";

/**
 * Copying the post author's avatar onto our own blob store.
 *
 * Instagram serves profile pictures from the same signed `scontent-*` CDN as
 * post images, so an avatar URL stored as-is answers `403 URL signature
 * expired` within days — the identical failure lib/post-thumbnail.ts exists to
 * prevent, and the fetch-sniff-store step is shared with it via
 * lib/cdn-image-backup.ts.
 *
 * ## Why there is no delete path here
 *
 * Thumbnails get a reference count and a delete; avatars deliberately get
 * neither, and that asymmetry is the point of this file being separate.
 *
 * A thumbnail belongs to exactly one post, so "no row points at this any more"
 * is a question with a useful answer. An avatar belongs to a *handle*, which
 * this app has no row for — the same picture is copied onto every post by
 * `mo_muknyang`, and re-saving any one of them writes a fresh blob that the
 * others do not learn about. Counting references and deleting at zero would
 * therefore fire constantly on the normal case (a re-save of the only post by
 * an author) while the shared-handle case leaks anyway.
 *
 * So avatar blobs are never deleted. The cost is storage for a 150px JPEG per
 * author per re-save; the cost of the alternative is deleting an image that a
 * sibling post still renders. This repo already takes that trade the same way
 * on the thumbnail save path, where one leaked blob is accepted over a
 * `SELECT … FOR UPDATE` on the hot path.
 *
 * Consequently nothing here imports `del`, and the ESLint rule that pins
 * `@vercel/blob`'s `del` to two files does not need a third entry.
 *
 * ## This module never throws
 *
 * Same contract as lib/post-thumbnail.ts. An avatar is decoration on work the
 * user asked for; a missing `BLOB_READ_WRITE_TOKEN` must never fail a save.
 */

/**
 * 1MB. Instagram avatars are 150x150 in the og tags and measure a few tens of
 * KB — an order of magnitude under this. Half the thumbnail cap because the
 * expected payload is far smaller, so the same "well clear of real traffic"
 * margin needs a smaller number.
 */
const MAX_AVATAR_BYTES = 1024 * 1024;

/**
 * Path prefix every author avatar is stored under, separate from
 * `post-thumbnail/` and `profile/`. Load-bearing: those prefixes are how
 * isOwnThumbnailBlob() and isOwnProfileImageBlob() tell their own blobs from
 * everyone else's in the shared store, and an avatar landing under either one
 * would become eligible for a delete it must never receive.
 */
const BLOB_PREFIX = "post-author";

/**
 * Shorter than the thumbnail's. The avatar is the least important byte in the
 * pipeline — a post with no avatar renders an initial, a post with no thumbnail
 * renders a grey box — so it gets the smallest slice of the route's budget.
 */
const FETCH_TIMEOUT_MS = 4_000;

const SPEC: BackupSpec = {
  logTag: "ingest:author-image",
  prefix: BLOB_PREFIX,
  basename: "avatar",
  allowedHosts: INSTAGRAM_CDN_HOSTS,
  maxBytes: MAX_AVATAR_BYTES,
  timeoutMs: FETCH_TIMEOUT_MS,
};

/**
 * Returns `metadata` with its Instagram author avatar replaced by a backed-up
 * blob URL, or unchanged if there is nothing to back up or the backup failed.
 *
 * Mirrors backupThumbnail(): the platform test, the null test and the fallback
 * all live here so the ingest route carries no branch of its own. On success
 * `authorImage` points at our blob and `authorImageSource` holds the original
 * CDN URL, the same "render this / this proves it was backed up" pairing the
 * thumbnail columns use.
 */
export async function backupAuthorImage(
  metadata: PostMetadata,
): Promise<PostMetadata> {
  if (metadata.platform !== Platform.INSTAGRAM || !metadata.authorImage) {
    return metadata;
  }

  const stored = await fetchAndPutImage(metadata.authorImage, SPEC);
  if (!stored) return metadata;

  return {
    ...metadata,
    authorImage: stored,
    authorImageSource: metadata.authorImage,
  };
}

/**
 * Whether `url` is an author avatar in our own blob store.
 *
 * Used only to decide whether the column may record an `authorImageSource`, so
 * the row never claims a platform CDN URL was backed up. Nothing deletes on
 * this — see the module comment on why avatars have no delete path.
 */
export function isOwnAuthorImageBlob(url: string | null): boolean {
  return isOwnBlobUnder(url, BLOB_PREFIX);
}
