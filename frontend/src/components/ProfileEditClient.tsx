"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, ChevronLeft, X } from "lucide-react";
import { displayName } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";

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
 * Re-encodes a picked image down to `MAX_EDGE` as WEBP.
 *
 * Returns the original file when anything in the canvas path fails. For a JPEG
 * or PNG that just costs bytes — the server takes it either way. For HEIC it is
 * the difference between a working upload and a rejection, because the server
 * allowlist has no HEIC in it: a browser that cannot decode HEIC also cannot
 * render it back, so storing one would mean a successful save and an empty
 * avatar. Failing with the route's Korean message is the better end of that.
 */
async function downscale(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small enough — re-encoding would only lose quality.
    if (scale === 1) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85),
    );
    if (!blob) return file;
    return new File([blob], "profile.webp", { type: "image/webp" });
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
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="지도로 돌아가기"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "rounded-full text-muted-foreground",
          )}
        >
          <ChevronLeft aria-hidden />
        </Link>
        <h1 className="text-base font-semibold">프로필 수정</h1>
      </header>

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

          {/* HEIC stays in `accept` even though the server rejects it: iOS camera
              roll pictures are HEIC, and downscale() re-encodes them to WEBP
              before the upload. Dropping it here would grey out most of an
              iPhone's photos in the picker. */}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
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
  );
}
