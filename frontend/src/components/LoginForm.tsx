"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Callback errors arrive as `?error=` slugs; anything else falls through. */
const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "로그인을 취소했습니다.",
  state_mismatch: "로그인 요청이 만료되었습니다. 다시 시도해 주세요.",
  missing_code: "로그인에 실패했습니다. 다시 시도해 주세요.",
  provider_error: "제공자에서 로그인을 처리하지 못했습니다.",
  provider_unavailable: "현재 이 방법으로 로그인할 수 없습니다.",
  unsupported_provider: "지원하지 않는 로그인 방식입니다.",
  login_failed: "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.",
};

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);

  const errorSlug = searchParams.get("error");
  const [error, setError] = useState<string | null>(
    errorSlug ? (ERROR_MESSAGES[errorSlug] ?? "로그인에 실패했습니다.") : null,
  );

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
      {/* A plain link, not a fetch: the provider handshake is a series of
          top-level navigations, so it works with JavaScript disabled too. */}
      <a
        href="/api/auth/naver/start"
        onClick={() => setPending(true)}
        aria-disabled={pending}
        className="rounded-lg bg-[#03C75A] px-4 py-3 text-center text-sm font-medium text-white transition hover:brightness-95"
      >
        네이버로 계속하기
      </a>
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
