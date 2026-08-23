import { put } from "@vercel/blob";
import {
  IMAGE_EXTENSIONS,
  IMAGE_SNIFF_BYTES,
  sniffImageType,
} from "@/lib/image-bytes";

/**
 * Copying an image off a platform CDN onto our own blob store.
 *
 * Extracted from lib/post-thumbnail.ts once a second caller appeared: author
 * avatars expire for exactly the same reason post thumbnails do, and had this
 * stayed inlined the two would have drifted — one of them eventually missing
 * the redirect check, or the sniff, or the size cap. Those three are the whole
 * security surface of fetching bytes from a host we do not control, so they
 * live in one place and every caller gets all of them.
 *
 * ## This module never throws
 *
 * Same contract as lib/post-thumbnail.ts, and for the same reason: every caller
 * is doing work the user never asked for, as a side effect of saving a link.
 * Failing a save because `BLOB_READ_WRITE_TOKEN` is missing — the normal state
 * of a local checkout — would let one deployment gap stop the product. Storing
 * a URL that will expire is always better than storing nothing.
 *
 * So there is no error class here and no branch in lib/api.ts. Every failure
 * ends as a log line and null, and the caller keeps the original URL.
 */

/**
 * Why a backup did not happen. Distinct values rather than one collapsed
 * warning because "we have no token" and "Instagram is blocking us" call for
 * opposite responses, and a single message tells the next reader neither.
 */
export type BackupFailure =
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

export type BackupSpec = {
  /**
   * Log prefix identifying the caller, e.g. `ingest:thumbnail`. Only ever read
   * by a human reading logs.
   */
  logTag: string;
  /**
   * Path prefix every blob from this caller is stored under. Load-bearing, not
   * cosmetic: the ownership predicates read it to tell one category of blob
   * from another sharing the same store, and that is what gates deletes.
   * Changing it orphans every blob written under the old prefix.
   */
  prefix: string;
  /** Basename the stored object gets, before the extension and random suffix. */
  basename: string;
  /** Hosts we are willing to fetch bytes from. */
  allowedHosts: RegExp[];
  maxBytes: number;
  timeoutMs: number;
};

function logFailure(
  spec: BackupSpec,
  reason: BackupFailure,
  sourceUrl: string,
  context: Record<string, string | number | undefined> = {},
) {
  const details = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const line =
    `[${spec.logTag}] backup skipped reason=${reason}` +
    `${details ? ` ${details}` : ""} url=${sourceUrl}`;

  // A missing token is a deployment fact, not a failure to investigate.
  if (reason === "no_token") console.info(line);
  else console.warn(line);
}

/**
 * Downloads `cdnUrl` and stores it as a public blob, returning its URL — or
 * null if anything at all went wrong.
 */
export async function fetchAndPutImage(
  cdnUrl: string,
  spec: BackupSpec,
): Promise<string | null> {
  // Checked before the fetch so a tokenless environment never touches the
  // platform CDN for bytes it cannot store anyway.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    logFailure(spec, "no_token", cdnUrl);
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(cdnUrl);
  } catch {
    logFailure(spec, "unsupported_host", cdnUrl);
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    !spec.allowedHosts.some((pattern) => pattern.test(parsed.hostname))
  ) {
    logFailure(spec, "unsupported_host", cdnUrl, { host: parsed.hostname });
    return null;
  }

  try {
    const res = await fetch(cdnUrl, {
      // Not "follow". A redirect would move the request off the host the
      // allowlist just checked, leaving the check applied to the first hop
      // only. Instagram's CDN answers directly, so there is nothing to follow.
      redirect: "manual",
      signal: AbortSignal.timeout(spec.timeoutMs),
      cache: "no-store",
    });

    if (res.status >= 300 && res.status < 400) {
      logFailure(spec, "redirected", cdnUrl, {
        status: res.status,
        location: res.headers.get("location") ?? undefined,
      });
      return null;
    }
    if (!res.ok) {
      // 403 here means the signature had already expired by the time we tried,
      // which happens when Instagram hands out a very short-lived URL.
      logFailure(spec, "http_error", cdnUrl, { status: res.status });
      return null;
    }

    // Cheap rejection first: if the CDN tells us it is oversized, stop before
    // reading a body we would only discard. Written as an explicit
    // header-present test because Number(null) is 0, which would silently read
    // as "well within the cap" rather than "no answer".
    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > spec.maxBytes) {
      logFailure(spec, "too_large", cdnUrl, { declaredBytes: declared });
      return null;
    }

    // The header above may be absent or lying, so the real length decides. Note
    // this buffers the whole body first: the cap is enforced after the transfer,
    // not during it. Acceptable because the allowlist means only the platform's
    // CDN is ever on the other end; a genuinely hostile host on that list could
    // make us buffer more than the cap once, which is why the host check is
    // first.
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > spec.maxBytes) {
      logFailure(spec, "too_large", cdnUrl, { bytes: bytes.byteLength });
      return null;
    }

    // The bytes decide the type. The CDN's Content-Type header is a claim, and
    // comparing it against the sniff would buy nothing — what we store as
    // `contentType` is the sniff result either way. The check that matters is
    // that bytes we are about to serve publicly really are one of the formats
    // on the allowlist, which is what keeps an SVG (a script carrier on the
    // blob origin) out.
    const sniffed = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
    if (!sniffed) {
      logFailure(spec, "unsupported_type", cdnUrl, { bytes: bytes.byteLength });
      return null;
    }
    const extension = IMAGE_EXTENSIONS.get(sniffed)!;

    // Not resized. There is no image library in this project, and adding one
    // would weigh down the bundle and the build to save bandwidth on a small
    // render. Keeping the original bytes also leaves resizing available later.
    //
    // Wrapped in a Blob because put() takes no bare Uint8Array. Its own type is
    // left unset — `contentType` below is what Blob stores and serves.
    //
    // The key encodes nothing about the post: addRandomSuffix is what makes
    // each URL unique. The extension is a suffix so the stored object is
    // self-describing in the Blob dashboard and the URL ends the way consumers
    // expect.
    const blob = await put(
      `${spec.prefix}/${spec.basename}.${extension}`,
      new Blob([bytes]),
      {
        access: "public",
        // A random suffix, never a key derived from the post. A stable key
        // would be overwritten in place and the blob CDN would keep serving
        // the old bytes under the unchanged URL — the trap profile pictures
        // hit.
        addRandomSuffix: true,
        contentType: sniffed,
      },
    );
    return blob.url;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "TimeoutError") {
      logFailure(spec, "fetch_timeout", cdnUrl, { timeoutMs: spec.timeoutMs });
      return null;
    }
    if (cause instanceof Error) {
      // `fetch` reports transport faults as TypeError; anything else here came
      // from the Blob SDK (a missing store, a revoked token, a quota).
      const reason = cause.name === "TypeError" ? "network" : "blob_error";
      logFailure(spec, reason, cdnUrl, {
        errorName: cause.name,
        errorMessage: cause.message,
      });
      return null;
    }
    logFailure(spec, "unknown", cdnUrl, { errorMessage: String(cause) });
    return null;
  }
}

/**
 * Whether `url` is a blob of ours stored under `prefix`.
 *
 * **Necessary but not sufficient for deleting it.** This answers "is this one
 * of ours", not "is this one *this user's*" — and the URL cannot answer the
 * second question, because blob URLs are public. Every caller that deletes
 * pairs this with a reference count and deletes only at zero; that count is
 * the actual ownership check.
 *
 * What this rules out is a URL pointing anywhere other than the given prefix —
 * an arbitrary host, or another prefix in the same store where a mistaken
 * delete would take out an avatar or a profile picture.
 *
 * The host is matched against the shape Blob actually serves from,
 * `<store>.public.blob.vercel-storage.com`. Matching the broader
 * `.blob.vercel-storage.com` would also accept another Vercel customer's store
 * host, which is not ours to reason about.
 */
export function isOwnBlobUnder(url: string | null, prefix: string): boolean {
  if (!url) return false;
  try {
    const { protocol, hostname, pathname } = new URL(url);
    // `new URL()` normalises the path before this reads it, so `..` segments
    // and percent-encoded separators are already resolved — a traversal out of
    // the prefix fails the startsWith rather than sneaking past it.
    const dir = `/${prefix}/`;
    return (
      protocol === "https:" &&
      hostname.endsWith(".public.blob.vercel-storage.com") &&
      pathname.startsWith(dir) &&
      // The directory itself names no object.
      pathname.length > dir.length
    );
  } catch {
    return false;
  }
}

/**
 * Hosts Instagram serves images from. Not user input — the server parsed the
 * URL out of Instagram's own HTML moments earlier, which is the entire reason
 * these backups happen at ingest time rather than at save time (a URL from a
 * request body would make this an SSRF sink). But it is still a string
 * Instagram chose, so the host is pinned rather than trusted.
 */
export const INSTAGRAM_CDN_HOSTS = [
  /^scontent[\w.-]*\.cdninstagram\.com$/,
  /\.fbcdn\.net$/,
];
