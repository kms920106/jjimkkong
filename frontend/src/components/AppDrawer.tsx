"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Pencil } from "lucide-react";
import { displayName, type MapProvider, type ProfileDTO } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

const PROVIDERS: Array<{ value: MapProvider; label: string }> = [
  { value: "NAVER", label: "네이버 지도" },
  { value: "KAKAO", label: "카카오맵" },
  { value: "GOOGLE", label: "구글 지도" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  profile: ProfileDTO;
  savedCount: number;
};

export default function AppDrawer({
  open,
  onClose,
  profile,
  savedCount,
}: Props) {
  const router = useRouter();
  const [nickname, setNickname] = useState(profile.nickname ?? "");
  const [editingName, setEditingName] = useState(false);
  // Only holds the value of an in-flight save. The prop is the source of
  // truth the rest of the time, so a router.refresh() lands here without the
  // panel needing an effect to copy props into state.
  const [pendingProvider, setPendingProvider] = useState<MapProvider | null>(
    null,
  );
  const provider = pendingProvider ?? profile.mapProvider;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  // Separate from `error`, which renders inside the settings nav — a failed
  // withdrawal has to appear in the dialog the user is looking at.
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("설정을 저장하지 못했습니다.");
      router.refresh();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "설정을 저장하지 못했습니다.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function selectProvider(next: MapProvider) {
    if (next === provider || saving) return;
    setPendingProvider(next);
    // Cleared either way: on success the refreshed prop carries the new
    // value, and on failure the radio has to snap back to the old one.
    await patch({ mapProvider: next });
    setPendingProvider(null);
  }

  async function saveNickname() {
    const trimmed = nickname.trim();
    if (trimmed === (profile.nickname ?? "")) {
      setEditingName(false);
      return;
    }
    if (await patch({ nickname: trimmed })) setEditingName(false);
  }

  async function signOut() {
    // Revokes the session row as well as the cookie, so the token is dead
    // even if a copy of it was captured.
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    onClose();
    // Home, not a login page — there is no longer one. refresh() rebuilds the
    // tree without the session, which is what empties the map of pins.
    router.push("/");
    router.refresh();
  }

  async function withdraw() {
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      // No body: the dialog itself is the confirmation, so there is nothing to
      // send. Content-Type is still set — it is what forces a CORS preflight on
      // a cross-origin attempt, which requireSameOrigin() then rejects outright.
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string" ? body.error : "탈퇴하지 못했습니다.",
        );
      }
      setWithdrawOpen(false);
      onClose();
      // Same landing as sign-out: the account is gone, so refresh() rebuilds
      // the tree with no session and the map comes back empty.
      router.push("/");
      router.refresh();
    } catch (cause) {
      setWithdrawError(
        cause instanceof Error ? cause.message : "탈퇴하지 못했습니다.",
      );
      setWithdrawing(false);
    }
  }

  const name = displayName({ nickname: profile.nickname, email: profile.email });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="left" className="w-[85%] max-w-sm gap-0 sm:max-w-sm">
        <SheetTitle className="sr-only">메뉴</SheetTitle>

        {/* Clears SheetContent's own close button, which sits at top-3 and is
            7 units tall — the nickname field grows to the full width when
            editing, so it would otherwise run under it. */}
        <div className="flex items-center gap-3 px-5 pt-12 pb-6">
          <Avatar className="h-12 w-12">
            <AvatarFallback className="text-lg font-semibold">
              {name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveNickname();
                }}
                className="flex items-center gap-2"
              >
                <Input
                  autoFocus
                  value={nickname}
                  maxLength={20}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="닉네임"
                  className="min-w-0 flex-1"
                />
                <Button type="submit" size="sm" disabled={saving}>
                  저장
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  // Seeded here rather than from a prop effect, so the field
                  // always opens on whatever the server last confirmed.
                  setNickname(profile.nickname ?? "");
                  setEditingName(true);
                }}
                className="flex max-w-full items-center gap-1.5 text-left"
              >
                <span className="truncate text-base font-semibold">{name}</span>
                <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="sr-only">닉네임 편집</span>
              </button>
            )}
            {profile.email && (
              <p className="truncate text-xs text-muted-foreground">
                {profile.email}
              </p>
            )}
            {/* Masked by the server; the full number is never sent here. */}
            {profile.phoneMasked && (
              <p className="truncate text-xs text-muted-foreground">
                {profile.phoneMasked}
              </p>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-5 pb-6">
          <Link
            href="/links"
            onClick={onClose}
            className="flex items-center justify-between rounded-xl border border-border px-4 py-3.5 transition hover:bg-muted"
          >
            <span className="text-sm font-medium">링크</span>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {savedCount}
              <ChevronRight className="h-4 w-4" />
            </span>
          </Link>

          <h2 className="px-1 pt-7 pb-2 text-xs font-semibold text-muted-foreground">
            지도
          </h2>
          <RadioGroup
            value={provider}
            onValueChange={(next) => void selectProvider(next as MapProvider)}
            disabled={saving}
            className="gap-2"
          >
            {PROVIDERS.map((item) => (
              <Label
                key={item.value}
                className="cursor-pointer gap-3 rounded-xl border border-border px-4 py-3 transition hover:bg-muted"
              >
                <RadioGroupItem value={item.value} />
                <span className="text-sm font-medium">{item.label}</span>
              </Label>
            ))}
          </RadioGroup>

          {error && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </nav>

        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          <Button variant="ghost" size="sm" onClick={signOut}>
            로그아웃
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Reset here, not on close: reopening after a failed attempt
              // should start clean, and the dialog keeps no state of its own.
              setWithdrawError(null);
              setWithdrawOpen(true);
            }}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            회원탈퇴
          </Button>
        </div>

        <AlertDialog
          open={withdrawOpen}
          onOpenChange={(next) => {
            // Mid-delete: dismissing would leave the user on a page whose
            // account may already be gone, with no indication either way.
            if (!next && withdrawing) return;
            setWithdrawOpen(next);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>회원탈퇴</AlertDialogTitle>
              <AlertDialogDescription>
                탈퇴하면 지금 바로 로그아웃되고, 저장한 링크 {savedCount}개를 다시
                볼 수 없습니다. 같은 계정으로 다시 로그인하더라도 새 계정으로
                시작하며 이전 링크는 복구되지 않습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {withdrawError && (
              <Alert variant="destructive">
                <AlertDescription>{withdrawError}</AlertDescription>
              </Alert>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={withdrawing}>취소</AlertDialogCancel>
              <AlertDialogAction
                // A plain Button, not a Base UI Close, so nothing dismisses the
                // dialog for us — withdraw() closes it, and only once the
                // delete actually succeeded. A Close here would tear the dialog
                // down mid-request and swallow the error message.
                onClick={() => void withdraw()}
                disabled={withdrawing}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {withdrawing ? "탈퇴 중…" : "탈퇴하기"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
