import { BlobError, del, put } from "@vercel/blob";

/** Thrown when an upload is the wrong type or too large. Becomes a 400. */
export class ProfileImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileImageError";
  }
}

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
 * But the allowlist alone is not enough — see sniff() below. `file.type` comes
 * from the multipart part header, which the caller writes, so checking it only
 * proves the caller typed one of these strings.
 *
 * HEIC/HEIF are absent deliberately. iOS Safari decodes them, so downscale() in
 * the client re-encodes those to WEBP before they ever arrive; a browser that
 * cannot decode HEIC would send the original through, and then cannot render it
 * back either — the user would get a successful save and an empty avatar.
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

/**
 * Reads the leading bytes and returns the MIME type they actually are.
 *
 * The declared `file.type` is attacker controlled — it is a header the caller
 * wrote — so validating it and then pinning it as the stored `contentType`
 * would let anyone host arbitrary bytes on the blob origin under a type of
 * their choosing. This makes the bytes decide, and the caller's claim only has
 * to agree.
 */
async function sniff(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());

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

/**
 * 6MB. Phone photos land around 2-4MB unresized, and the client downscales
 * before sending — this is the backstop for a caller that skips that step,
 * not the expected size.
 *
 * Exported because the route sheds obviously oversized bodies before parsing
 * them; both checks have to name the same number or one of them is decoration.
 */
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

/**
 * Stores `file` as `userId`'s profile picture and returns its public URL.
 *
 * Keyed by user id with a random suffix (`addRandomSuffix`), not by id alone.
 * A stable key would be overwritten in place, and the blob CDN would keep
 * serving the previous image from cache under the unchanged URL — the user
 * uploads a new picture and sees the old one. A fresh URL every time makes the
 * change visible immediately; the superseded blob is deleted by the caller.
 */
export async function putProfileImage(
  userId: string,
  file: File,
): Promise<string> {
  if (file.size === 0) {
    throw new ProfileImageError("이미지 파일이 비어 있습니다.");
  }
  // Checked before sniffing so an oversized file is rejected without reading
  // any of it.
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ProfileImageError("이미지 크기는 6MB까지만 올릴 수 있습니다.");
  }

  // The bytes decide the type, not the caller's header. The declared value
  // still has to agree — a mismatch means the caller is describing the file as
  // something it is not, which is never an honest upload.
  const sniffed = await sniff(file);
  if (!sniffed || sniffed !== file.type) {
    throw new ProfileImageError(
      "JPG, PNG, WEBP, GIF 이미지만 올릴 수 있습니다.",
    );
  }
  const { extension } = ALLOWED_TYPES.get(sniffed)!;

  try {
    // `contentType` comes from the sniff, not from the request, so what Blob
    // serves is the type the bytes actually are. The extension is on the
    // pathname as well, which is what makes the stored object self-describing
    // in the Blob dashboard.
    const blob = await put(`profile/${userId}.${extension}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: sniffed,
    });
    return blob.url;
  } catch (error) {
    // Every storage-side failure lands here, including the commonest one by far:
    // no BLOB_READ_WRITE_TOKEN, which is a deployment gap rather than anything
    // the user did. Logged with the real cause and surfaced as a retry message,
    // because the alternative — the generic 500 — leaves no trail pointing at
    // the missing env var.
    if (error instanceof BlobError) {
      console.error("Blob upload failed:", error);
      throw new ProfileImageError(
        "사진을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    throw error;
  }
}

/**
 * Deletes a blob that is no longer referenced, ignoring failures.
 *
 * Best effort on purpose: the row already points at the new image, so a failed
 * delete leaks a blob but never breaks the profile. Throwing here would fail a
 * save that actually succeeded.
 *
 * Only called with a URL read back from the row being replaced, so it can never
 * be aimed at another user's blob by a request body.
 */
export async function deleteProfileImage(url: string | null): Promise<void> {
  if (!url) return;
  try {
    await del(url);
  } catch (error) {
    console.error("Failed to delete superseded profile image:", error);
  }
}
