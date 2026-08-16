"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { displayName, type MapProvider, type ProfileDTO } from "@/lib/types";

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
  const panelRef = useRef<HTMLDivElement>(null);
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

  // Escape is the expected way out of an overlay, and moving focus into the
  // panel keeps the keyboard from staying behind it on the map.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

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
    // Clears the dev test session if one is set; 404s harmlessly in production.
    await fetch("/api/dev-logout", { method: "POST" }).catch(() => {});
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const name = displayName({ nickname: profile.nickname, email: profile.email });

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="메뉴"
        tabIndex={-1}
        // Kept mounted and translated off-screen so the panel can animate in
        // both directions; aria-hidden keeps it out of the tree when closed.
        aria-hidden={!open}
        inert={!open || undefined}
        className={`fixed inset-y-0 left-0 z-50 flex w-[85%] max-w-sm flex-col bg-white shadow-xl transition-transform duration-200 outline-none dark:bg-neutral-950 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-end px-4 pt-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="메뉴 닫기"
            className="rounded-full p-2 text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-900"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3 px-5 pt-2 pb-6">
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-lg font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveNickname();
                }}
                className="flex items-center gap-2"
              >
                <input
                  autoFocus
                  value={nickname}
                  maxLength={20}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="닉네임"
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                >
                  저장
                </button>
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
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 text-neutral-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z" />
                </svg>
                <span className="sr-only">닉네임 편집</span>
              </button>
            )}
            {profile.email && (
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                {profile.email}
              </p>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-5 pb-6">
          <Link
            href="/posts"
            onClick={onClose}
            className="flex items-center justify-between rounded-xl border border-neutral-200 px-4 py-3.5 transition hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            <span className="text-sm font-medium">저장한 게시글</span>
            <span className="flex items-center gap-2 text-sm text-neutral-400">
              {savedCount}
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </Link>

          <h2 className="px-1 pt-7 pb-2 text-xs font-semibold text-neutral-400">
            지도
          </h2>
          <ul className="flex flex-col gap-2">
            {PROVIDERS.map((item) => (
              <li key={item.value}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 transition hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">
                  <input
                    type="radio"
                    name="mapProvider"
                    value={item.value}
                    checked={provider === item.value}
                    onChange={() => selectProvider(item.value)}
                    disabled={saving}
                  />
                  <span className="text-sm font-medium">{item.label}</span>
                </label>
              </li>
            ))}
          </ul>

          {error && (
            <p className="pt-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </nav>

        <div className="border-t border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={signOut}
            className="text-sm text-neutral-500 transition hover:text-neutral-900 dark:hover:text-white"
          >
            로그아웃
          </button>
        </div>
      </div>
    </>
  );
}
