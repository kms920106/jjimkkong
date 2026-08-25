import { BlobError, del, put } from "@vercel/blob";
import {
  IMAGE_EXTENSIONS,
  IMAGE_SNIFF_BYTES,
  sniffImageType,
} from "@/lib/image-bytes";

/**
 * Thrown when an upload is the wrong type or too large. Becomes a 400.
 *
 * Throwing at all is what separates this module from lib/post-thumbnail.ts,
 * which stores images on the same CDN and never throws. A profile picture
 * upload *is* the action the user asked for, so a failure has to be told to
 * them. A thumbnail backup is work they never requested, so a failure there
 * falls back silently instead of failing the save around it.
 */
export class ProfileImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileImageError";
  }
}

/**
 * The MIME type `file`'s bytes actually are, per the shared allowlist.
 *
 * Only the read is local to this module; the signature table and the matching
 * live in lib/image-bytes.ts because post thumbnails ask the same question of
 * bytes that never arrive as a `File`.
 */
async function sniff(file: File): Promise<string | null> {
  const head = new Uint8Array(
    await file.slice(0, IMAGE_SNIFF_BYTES).arrayBuffer(),
  );
  return sniffImageType(head);
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
 * Stores `file` as `memberId`'s profile picture and returns its public URL.
 *
 * Keyed by user id with a random suffix (`addRandomSuffix`), not by id alone.
 * A stable key would be overwritten in place, and the blob CDN would keep
 * serving the previous image from cache under the unchanged URL — the user
 * uploads a new picture and sees the old one. A fresh URL every time makes the
 * change visible immediately; the superseded blob is deleted by the caller.
 */
export async function putProfileImage(
  memberId: number,
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
  const extension = IMAGE_EXTENSIONS.get(sniffed)!;

  try {
    // `contentType` comes from the sniff, not from the request, so what Blob
    // serves is the type the bytes actually are. The extension is on the
    // pathname as well, which is what makes the stored object self-describing
    // in the Blob dashboard.
    //
    // `addRandomSuffix` is doing more work than cache-busting since memberId
    // became a small int (20260825): `profile/1.jpg` would otherwise be a
    // guessable object name, and these URLs are public. The suffix is what
    // keeps the path unguessable — do not drop it to get tidier names.
    const blob = await put(`profile/${memberId}.${extension}`, file, {
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
