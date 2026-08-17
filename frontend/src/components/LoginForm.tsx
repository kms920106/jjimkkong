"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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
          top-level navigations, so it works with JavaScript disabled too.
          `render` keeps the anchor as the rendered element; #03C75A is
          Naver's mandated brand color, so it stays hardcoded. */}
      <Button
        render={<a href="/api/auth/naver/start">네이버로 계속하기</a>}
        onClick={() => setPending(true)}
        aria-disabled={pending}
        className="h-auto bg-[#03C75A] px-4 py-3 text-white hover:bg-[#03C75A] hover:brightness-95"
      />
      <div className="my-1 flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        개발용
        <Separator className="flex-1" />
      </div>
      {/* Dashed border marks this as the development-only auth bypass. */}
      <Button
        type="button"
        variant="outline"
        onClick={signInAsTestUser}
        disabled={pending}
        className="h-auto border-dashed px-4 py-3 text-muted-foreground"
      >
        테스트 계정으로 로그인
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-center">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
