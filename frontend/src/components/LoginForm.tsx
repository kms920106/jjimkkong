"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get("error"),
  );

  async function signIn(provider: "google" | "kakao") {
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (signInError) {
      setError(signInError.message);
      setPending(false);
    }
    // On success the browser navigates away; leave `pending` set.
  }

  async function signInAsTestUser() {
    setPending(true);
    setError(null);

    const response = await fetch("/api/dev-login", { method: "POST" });
    if (!response.ok) {
      setError("테스트 로그인에 실패했습니다.");
      setPending(false);
      return;
    }

    // refresh() first so the RSC cache is rebuilt with the new cookie; without
    // it the proxy would serve the cached logged-out tree and bounce back here.
    router.refresh();
    router.push("/");
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <button
        type="button"
        onClick={() => signIn("google")}
        disabled={pending}
        className="rounded-lg border border-neutral-300 px-4 py-3 text-sm font-medium transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Google로 계속하기
      </button>
      <button
        type="button"
        onClick={() => signIn("kakao")}
        disabled={pending}
        className="rounded-lg bg-[#FEE500] px-4 py-3 text-sm font-medium text-black transition hover:brightness-95 disabled:opacity-50"
      >
        카카오로 계속하기
      </button>
      <div className="my-1 flex items-center gap-3 text-xs text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        개발용
        <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <button
        type="button"
        onClick={signInAsTestUser}
        disabled={pending}
        className="rounded-lg border border-dashed border-neutral-400 px-4 py-3 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        테스트 계정으로 로그인
      </button>
      {error && (
        <p className="text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
