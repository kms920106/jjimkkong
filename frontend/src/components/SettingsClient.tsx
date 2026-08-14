"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { MapProvider } from "@/lib/types";

const PROVIDERS: Array<{ value: MapProvider; label: string; note: string }> = [
  { value: "NAVER", label: "네이버 지도", note: "기본값" },
  { value: "KAKAO", label: "카카오맵", note: "" },
  { value: "GOOGLE", label: "구글 지도", note: "" },
];

export default function SettingsClient({
  initialProvider,
}: {
  initialProvider: MapProvider;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState(initialProvider);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectProvider(next: MapProvider) {
    if (next === provider || saving) return;

    const previous = provider;
    setProvider(next);
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapProvider: next }),
      });
      if (!res.ok) throw new Error("설정을 저장하지 못했습니다.");
      router.refresh();
    } catch (cause) {
      setProvider(previous);
      setError(
        cause instanceof Error ? cause.message : "설정을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    // Clears the dev test session if one is set; 404s harmlessly in production.
    await fetch("/api/dev-logout", { method: "POST" }).catch(() => {});
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
          지도
        </h2>
        <ul className="flex flex-col gap-2">
          {PROVIDERS.map((item) => (
            <li key={item.value}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 p-3 transition hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">
                <input
                  type="radio"
                  name="mapProvider"
                  value={item.value}
                  checked={provider === item.value}
                  onChange={() => selectProvider(item.value)}
                  disabled={saving}
                />
                <span className="text-sm font-medium">{item.label}</span>
                {item.note && (
                  <span className="text-xs text-neutral-400">{item.note}</span>
                )}
              </label>
            </li>
          ))}
        </ul>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </section>

      <section>
        <button
          type="button"
          onClick={signOut}
          className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium transition hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          로그아웃
        </button>
      </section>
    </div>
  );
}
