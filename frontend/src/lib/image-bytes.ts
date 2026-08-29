/**
 * Deciding what an image file actually is from its leading bytes.
 *
 * Shared by the two places that store images on the blob CDN — profile pictures
 * (uploaded by the user) and post thumbnails (fetched by the server from a
 * platform CDN). They have different trust axes and so different callers, but
 * the same question is asked of the bytes: is this really one of the formats we
 * are willing to serve?
 */

/**
 * Formats every phone browser can produce from a camera roll or a capture, each
 * with the extension the stored blob gets and the byte signature that proves
 * the file really is that format.
 *
 * An allowlist rather than an `image/*` prefix check, because `image/svg+xml`
 * matches that prefix while being a script carrier: Blob serves what it is told
 * to serve, so an SVG here would be an XSS on the blob origin the moment anyone
 * opened the picture directly.
 *
 * But the allowlist alone is not enough — see sniffImageType() below. A caller
 * that declares a type (a multipart part header, a CDN's Content-Type) is only
 * telling us what it claims, never what the bytes are.
 *
 * HEIC/HEIF are absent deliberately, and this is the load-bearing half of a
 * two-part arrangement. downscale() in ProfileEditClient re-encodes a picked
 * HEIC to WEBP before it is ever sent, so an honest iPhone upload never reaches
 * this table as HEIC. What stays out is a HEIC that arrived anyway — from a
 * browser that could not decode it, or a caller that skipped the client
 * entirely. Storing that would be a successful save and an empty avatar,
 * because the browsers that cannot decode HEIC to upload it cannot render it
 * back either. Adding HEIC here to "fix" a rejected upload moves the failure
 * from a message the user can act on to a blank picture nobody can explain.
 */
const ALLOWED_TYPES = new Map<string, { extension: string; signature: number[] }>([
  // SOI marker. The third byte varies by encoder, so only two are fixed.
  ["image/jpeg", { extension: "jpg", signature: [0xff, 0xd8, 0xff] }],
  ["image/png", { extension: "png", signature: [0x89, 0x50, 0x4e, 0x47] }],
  // RIFF container: bytes 0-3 are "RIFF" and 8-11 are "WEBP", with the length
  // in between — so this signature is checked in two pieces.
  ["image/webp", { extension: "webp", signature: [0x52, 0x49, 0x46, 0x46] }],
  ["image/gif", { extension: "gif", signature: [0x47, 0x49, 0x46, 0x38] }],
]);

/** MIME type to the extension its stored blob gets. */
export const IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map(
  [...ALLOWED_TYPES].map(([type, { extension }]) => [type, extension]),
);

/** How many leading bytes {@link sniffImageType} needs to decide. */
export const IMAGE_SNIFF_BYTES = 12;

/**
 * Reads the leading bytes and returns the MIME type they actually are, or null
 * for anything not on the allowlist.
 *
 * A declared type — `file.type` on an upload, `Content-Type` on a fetched
 * response — is written by whoever sent the bytes. Validating that and then
 * pinning it as the stored `contentType` would let anyone host arbitrary bytes
 * on the blob origin under a type of their choosing. This makes the bytes
 * decide; a caller that also has a claim to check compares it against this.
 *
 * Needs at least {@link IMAGE_SNIFF_BYTES} bytes. A shorter buffer returns null
 * rather than guessing, since a truncated header cannot be told from a
 * mismatched one.
 */
export function sniffImageType(head: Uint8Array): string | null {
  if (head.length < IMAGE_SNIFF_BYTES) return null;

  for (const [type, { signature }] of ALLOWED_TYPES) {
    if (signature.some((byte, index) => head[index] !== byte)) continue;
    // The RIFF magic alone also covers WAV and AVI, so the subformat at byte 8
    // has to match too or an audio file would pass as an image.
    if (type === "image/webp") {
      const webp = [0x57, 0x45, 0x42, 0x50];
      if (webp.some((byte, index) => head[8 + index] !== byte)) continue;
    }
    return type;
  }
  return null;
}
