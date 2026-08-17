"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
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

export function loginErrorMessage(slug: string | null): string | null {
  if (!slug) return null;
  return ERROR_MESSAGES[slug] ?? "로그인에 실패했습니다.";
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where to land after the session is issued. The OAuth leg travels through it
   * as `?next=`; the test login reads it directly when it navigates.
   */
  redirectTo: string;
  /** Message from a `?error=` slug on the callback's failure redirect. */
  initialError?: string | null;
};

/**
 * Provider choice only. A social login that comes back without a phone number
 * continues on /verify-phone, which is a page because it has to refuse to render
 * when there is no pending login to verify against.
 */
export default function LoginDrawer({
  open,
  onOpenChange,
  redirectTo,
  initialError = null,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function signInAsTestUser() {
    setPending(true);
    setError(null);

    const response = await fetch("/api/dev-login", { method: "POST" });
    if (!response.ok) {
      setError("테스트 로그인에 실패했습니다.");
      setPending(false);
      return;
    }

    // Closing is explicit because `redirectTo` is usually the page the drawer
    // was opened on: navigating there keeps this component mounted, so nothing
    // would clear `pending` and the drawer would sit there with dead buttons
    // over the freshly logged-in page. refresh() rebuilds the tree with the new
    // session cookie, which is what fills the map back in.
    setPending(false);
    onOpenChange(false);
    router.refresh();
    router.push(redirectTo);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        // A login is mid-flight; closing here would leave the request to land
        // on a dismissed drawer with nothing to report failure to.
        if (!next && pending) return;
        onOpenChange(next);
      }}
      showSwipeHandle
    >
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader className="pb-4 text-center">
          <DrawerTitle>찜꽁 시작하기</DrawerTitle>
          <DrawerDescription>
            로그인하면 링크를 저장하고 지도에 남길 수 있습니다.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {/* A plain link, not a fetch: the provider handshake is a series of
              top-level navigations, so it works with JavaScript disabled too.
              `render` keeps the anchor as the rendered element; #03C75A is
              Naver's mandated brand color, so it stays hardcoded. The return
              path rides along as a query param so the callback can send the
              user back where they started. */}
          <Button
            render={
              <a
                href={`/api/auth/naver/start?next=${encodeURIComponent(redirectTo)}`}
              >
                네이버로 계속하기
              </a>
            }
            // The rendered element is an anchor, not a <button>; without this
            // Base UI warns that it is stripping native button semantics from
            // something it expected to be one.
            nativeButton={false}
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
              <AlertDescription className="text-center">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
