"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, X } from "lucide-react";
import { IMAGE_EXTENSIONS } from "@/lib/image-bytes";
import { displayName } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { SettingsHeader } from "@/components/SettingsHeader";

type Initial = {
  nickname: string | null;
  statusMessage: string | null;
  imageUrl: string | null;
  email: string | null;
};

/**
 * Longest edge of the stored picture, in CSS pixels.
 *
 * The avatar renders at 96px, so anything beyond a 2x display is bytes nobody
 * sees. Downscaling in the browser also keeps a 4MB phone photo from being
 * uploaded at all — the route's 6MB cap is the backstop, not the plan.
 */
const MAX_EDGE = 512;

/**
 * What the server allowlist accepts, so a file already on it can pass through.
 *
 * Derived from the server's own table rather than restated here. A hand-copied
 * list would drift the moment a format is added or removed there, and the
 * failure is silent in the worse direction: a type this set still claims is
 * accepted gets forwarded untouched and rejected at the route, which is exactly
 * the bug the re-encode path exists to prevent.
 *
 * Safe to import into a client component — lib/image-bytes.ts has no imports
 * and no server-only dependencies; it is a byte-signature table and a function
 * over a Uint8Array.
 */
const SERVER_TYPES = new Set(IMAGE_EXTENSIONS.keys());

/**
 * Decodes `file` to something drawable on a canvas.
 *
 * Two paths because neither alone covers both phones. `createImageBitmap` is
 * the fast one and is what desktop and Android use, but **Safari does not
 * decode HEIC through it** — it throws, and every iPhone camera roll picture is
 * HEIC. Safari *does* decode HEIC in an `<img>`, because that is the same
 * decoder the OS uses to show the photo. So the bitmap path is tried first and
 * the `<img>` path is the fallback that makes iPhone photos work at all.
 *
 * Do not collapse this to one path. Dropping the `<img>` fallback puts HEIC
 * back in the broken state; dropping createImageBitmap gives up off-main-thread
 * decoding on the browsers that have it.
 */
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      // decode() rejects on a format the browser cannot read, which is the
      // signal we want — an onload race would leave a 0x0 image instead.
      await image.decode();
      return image;
    } finally {
      // Safe immediately after decode(): the bitmap is already in memory and no
      // longer reads from the object URL.
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Re-encodes a picked image to WEBP, capped at `MAX_EDGE`.
 *
 * **Always re-encodes**, even when the picture is already small enough. That
 * looks wasteful and is not: the conversion is what makes a format the server
 * refuses — HEIC above all — into one it accepts. An early return on
 * `scale === 1` would let a small HEIC through untouched and the save would
 * fail with the allowlist message, which is exactly the bug this path exists to
 * prevent. The one exception is a file that is already on the server allowlist
 * *and* already small: nothing to gain, and re-encoding only loses quality.
 *
 * That exception reads `file.type`, which is written by the picker rather than
 * by the bytes, so it can be wrong — a HEIC renamed `.jpg` takes the
 * pass-through branch and is then refused by the server, whose sniff sees what
 * it really is. The cost of the lie is a re-pick with a message, never a bad
 * upload; the bytes are still what decide, one layer down.
 *
 * An animated GIF over `MAX_EDGE` loses its animation here — the canvas keeps
 * one frame. Accepted for a 96px avatar, and under `MAX_EDGE` it passes
 * through intact.
 *
 * Returns the original file when decoding fails. For a JPEG or PNG that just
 * costs bytes — the server takes it either way. For a format the server refuses
 * the save then fails with the route's Korean message, which is the right end
 * of that: storing an undecodable file would mean a successful save and an
 * empty avatar for everyone whose browser cannot render it back.
 */
async function downscale(file: File): Promise<File> {
  try {
    const source = await decode(file);
    // Released in one place because the correctness of every path below depends
    // on it happening; three copies at three early returns is a fourth one
    // waiting to be forgotten, and a missed release leaks a GPU-backed bitmap.
    try {
      // A decoder that resolves with a 0x0 image instead of rejecting would
      // otherwise produce a 0x0 canvas and upload a blank-but-valid WEBP — a
      // successful save and an empty avatar, which is the exact outcome the
      // server allowlist exists to prevent. Bailing out hands the original to
      // the server, which rejects it with a message the user can act on.
      if (!source.width || !source.height) return file;

      const scale = Math.min(
        1,
        MAX_EDGE / Math.max(source.width, source.height),
      );
      // Already small and already a format the server stores — re-encoding
      // would only lose quality. Anything else falls through to the canvas.
      if (scale === 1 && SERVER_TYPES.has(file.type)) return file;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(source.width * scale);
      canvas.height = Math.round(source.height * scale);
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.85),
      );
      if (!blob) return file;
      // A browser without WEBP encoding silently hands back a PNG here, so the
      // blob's own type decides the name — a .webp file that is really a PNG
      // would fail the server's sniff-vs-declared comparison. The `||` covers
      // a blob with no type at all, which would otherwise be declared as "" and
      // fail that same comparison with nothing to point at.
      const type = blob.type || "image/png";
      const extension = type === "image/webp" ? "webp" : "png";
      return new File([blob], `profile.${extension}`, { type });
    } finally {
      if (source instanceof ImageBitmap) source.close();
    }
  } catch {
    return file;
  }
}

/**
 * The profile edit page: picture, nickname, status message, one 완료 button.
 *
 * A page rather than another panel inside the settings drawer. The picture step
 * opens the OS file picker, which on iOS pushes the app out of the way and
 * unmounts nothing reliably — a drawer that may or may not still be open when
 * the user comes back is worse than a screen they can navigate away from.
 *
 * Everything saves in one PATCH so 완료 cannot half-apply: a failed upload must
 * not leave a renamed nickname behind.
 */
export default function ProfileEditClient({
  signedIn,
  initial,
}: {
  signedIn: boolean;
  initial: Initial;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(initial.nickname ?? "");
  const [statusMessage, setStatusMessage] = useState(
    initial.statusMessage ?? "",
  );
  /**
   * The picked file and its preview URL as one value.
   *
   * Kept together rather than deriving the URL in an effect: createObjectURL
   * has to be paired with a revoke, and holding the two in separate states
   * means every render between the pick and the effect shows a stale preview,
   * while a missed revoke leaks one blob per pick.
   *
   * Nothing is uploaded on selection — backing out of the page leaves no orphan
   * blob in storage.
   */
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  // Set when the user explicitly clears the picture. Distinct from `picked`
  // being null, which just means "unchanged".
  const [removed, setRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Frees the last preview when the page goes away. Replacements are revoked in
  // replacePicked() instead, which runs on the transition that supersedes them.
  useEffect(() => {
    const url = picked?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked?.url]);

  const shownImage = picked?.url ?? (removed ? null : initial.imageUrl);
  const name = displayName({ nickname, email: initial.email });

  function replacePicked(next: { file: File; url: string } | null) {
    setPicked((current) => {
      if (current && current.url !== next?.url) URL.revokeObjectURL(current.url);
      return next;
    });
  }

  async function pick(file: File) {
    setError(null);
    const scaled = await downscale(file);
    replacePicked({ file: scaled, url: URL.createObjectURL(scaled) });
    // A new picture supersedes an earlier removal.
    setRemoved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("nickname", nickname.trim());
      body.set("statusMessage", statusMessage.trim());
      if (picked) body.set("image", picked.file);
      else if (removed) body.set("removeImage", "1");

      // No Content-Type header: the browser has to set the multipart boundary
      // itself, and naming the type here would omit it and break parsing.
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        body,
      });
      if (!res.ok) {
        // The picture edits are optimistic — the avatar above already shows the
        // pick or the removal — so a rejected save has to put them back. Left
        // standing, a 401 shows an emptied avatar for a picture that is still
        // there, and the next save that does succeed deletes it for real.
        replacePicked(null);
        setRemoved(false);
        const payload = await res.json().catch(() => null);
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "프로필을 저장하지 못했습니다.",
        );
      }
      // Back to where the drawer was, with the tree rebuilt so the new
      // nickname and picture are already in place behind it.
      router.push("/");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "프로필을 저장하지 못했습니다.",
      );
    } finally {
      // Cleared even on the success path: router.push() does not unmount
      // synchronously, so an interrupted navigation would otherwise leave the
      // button stuck on 저장 중… with no way back but a reload.
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <SettingsHeader href="/" ariaLabel="지도로 돌아가기" title="프로필 수정" />

      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4">
        <div className="flex justify-center py-2">
          <div className="relative">
            <Avatar className="size-24">
              {/* Named, unlike the drawer's copy: there the adjacent nickname
                  carries the identity, but here the avatar is the subject of the
                  screen and whether a picture is set is exactly what the 삭제
                  button appearing depends on. */}
              {shownImage && <AvatarImage src={shownImage} alt="프로필 사진" />}
              <AvatarFallback className="text-3xl font-semibold">
                {name.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            {/* The camera badge is the picker's only trigger; the input itself
                stays hidden because a styled file input cannot be made to look
                like this across browsers. */}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={!signedIn || saving}
              aria-label="프로필 사진 변경"
              className="absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-background transition hover:bg-muted/80 disabled:opacity-50"
            >
              <Camera className="size-4" aria-hidden />
            </button>

            {shownImage && (
              <button
                type="button"
                onClick={() => {
                  replacePicked(null);
                  setRemoved(true);
                }}
                disabled={!signedIn || saving}
                aria-label="프로필 사진 삭제"
                className="absolute top-0 right-0 flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-background transition hover:bg-muted/80 disabled:opacity-50"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}

            {/* Wider than the server allowlist on purpose, and only an
                affordance — a picker filter is bypassable (drag-drop, "All
                Files"), so the real gate stays the server's magic-byte check.
                `image/*` covers the allowlist types and keeps Android gallery
                apps that ignore an explicit type list from greying out
                everything. HEIC/HEIF are named separately because iOS does not
                reliably file them under the wildcard, and they are most of an
                iPhone's camera roll — downscale() re-encodes them to WEBP on
                the way out. */}
            <input
              ref={fileInput}
              type="file"
              accept="image/*,image/heic,image/heif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so re-picking the same file fires change again — the
                // input keeps its value otherwise and the second pick is silent.
                event.target.value = "";
                if (file) void pick(file);
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="nickname">닉네임</Label>
          <Input
            id="nickname"
            value={nickname}
            maxLength={20}
            disabled={!signedIn || saving}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="닉네임을 입력해 주세요"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="statusMessage">상태메세지</Label>
          <Input
            id="statusMessage"
            value={statusMessage}
            maxLength={60}
            disabled={!signedIn || saving}
            onChange={(event) => setStatusMessage(event.target.value)}
            placeholder="상태메세지를 입력해 주세요"
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!signedIn && (
          <Alert>
            <AlertDescription>
              로그인한 뒤에 프로필을 수정할 수 있습니다.
            </AlertDescription>
          </Alert>
        )}

        <SubmitButton onClick={() => void save()} disabled={!signedIn || saving}>
          {saving ? "저장 중…" : "완료"}
        </SubmitButton>
      </div>
    </div>
  );
}
