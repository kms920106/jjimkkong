import {
  fetchAndPutImage,
  isOwnBlobUnder,
  type BackupSpec,
} from "@/lib/cdn-image-backup";

/**
 * Copying a place photo onto our own blob store.
 *
 * **Currently unused**, for the same reason as lib/ingest/place-image.ts: the
 * place-photo lookup was removed from the save path. Kept intact so the
 * feature can be restored without redoing the SSRF reasoning below.
 *
 * ## Why the bytes are copied
 *
 * Unlike the Instagram case, the URL Naver hands back is not a signed URL with
 * a visible expiry — so this is not fixing a known breakage. It is fixing an
 * unknown one: `search.pstatic.net` is a search *result*, an index that
 * re-points as the web changes, and the image behind it belongs to a third
 * party who may delete it. `Post` and `Place` are permanent and shared, so a
 * hot-linked photo means an unrelated site's housekeeping silently breaks a
 * pin for every member who saved that place.
 *
 * ## Only `thumbnail` is ever fetched, and that is a security boundary
 *
 * The search response carries two URLs. `link` is the image on its original
 * host — measured across 20 real rows, ten different hosts including
 * `tong.visitkorea.or.kr`, `img.siksinhot.com` and
 * `ssproxy.ucloudbiz.olleh.com`. Fetching that would let a search result
 * choose what this server requests, which is exactly the SSRF shape the
 * thumbnail backup avoids by living in ingest rather than in POST /api/posts.
 *
 * `thumbnail` is Naver's own re-host and came back as `search.pstatic.net` for
 * all 18 hits. That single host is the entire allowlist below. The tradeoff is
 * resolution — these are 150px-class images — and it is worth it: the
 * alternative is an allowlist that cannot be written down.
 *
 * ## This module never throws
 *
 * Same contract as post-thumbnail.ts and lib/ingest/place-image.ts. A place
 * photo is not what the user asked for; a missing BLOB_READ_WRITE_TOKEN is the
 * normal state of local development and must not fail a save.
 */

/**
 * Naver's search-image re-host, the only host this module will fetch from.
 * Anchored at both ends so a lookalike domain cannot match.
 *
 * Widening this is not a small change — see the module comment. If Naver ever
 * serves thumbnails from a second host, add that host here rather than
 * reaching for `link`.
 */
const NAVER_SEARCH_CDN_HOSTS = [/^search\.pstatic\.net$/];

/**
 * 2MB. Thumbnails measured in the low tens of KB, so this is a ceiling against
 * a surprise rather than a limit real traffic approaches.
 */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Path prefix every place photo is stored under, separate from
 * `post-thumbnail/`, `post-author/` and `profile/`. Load-bearing: those
 * prefixes are how each isOwn*Blob() tells its own blobs from the others in
 * the shared store, and `profile/` is the one prefix with a delete path.
 */
const BLOB_PREFIX = "place-image";

/**
 * Shorter than the thumbnail's 6s. This runs once per place, so a post naming
 * several of them multiplies the wait — and a missing photo costs the user
 * nothing, so it should be the first thing to give up.
 */
const FETCH_TIMEOUT_MS = 4_000;

const SPEC: BackupSpec = {
  logTag: "ingest:place-image",
  prefix: BLOB_PREFIX,
  basename: "place",
  allowedHosts: NAVER_SEARCH_CDN_HOSTS,
  maxBytes: MAX_IMAGE_BYTES,
  timeoutMs: FETCH_TIMEOUT_MS,
};

/** What a place row stores: the URL to render, and proof it was backed up. */
export type PlaceImage = {
  image: string | null;
  imageSource: string | null;
};

/**
 * Backs up one search-result URL.
 *
 * On success `image` is our blob and `imageSource` is the Naver URL it came
 * from — the same "render this / this proves it was backed up" pairing
 * thumbnail/thumbnailSource uses.
 *
 * On failure BOTH are null rather than falling back to the source URL. That
 * differs from post-thumbnail.ts on purpose: there, an expiring URL still
 * renders for a few days and is better than a grey box. Here the whole reason
 * to copy is that the source is a search index nobody promised to keep, so
 * storing it unbacked would write a URL into a shared, immutable row with no
 * way to tell later whether it still points at anything.
 */
export async function backupPlaceImage(
  cdnUrl: string | null,
): Promise<PlaceImage> {
  if (!cdnUrl) return { image: null, imageSource: null };

  const stored = await fetchAndPutImage(cdnUrl, SPEC);
  if (!stored) return { image: null, imageSource: null };

  return { image: stored, imageSource: cdnUrl };
}

/**
 * Whether `url` is a place photo in our own blob store.
 *
 * Nothing deletes on this — place photos have no delete path, for the reason
 * author avatars do not: the row is shared and immutable, so no blob is ever
 * displaced by a later write.
 */
export function isOwnPlaceImageBlob(url: string | null): boolean {
  return isOwnBlobUnder(url, BLOB_PREFIX);
}
