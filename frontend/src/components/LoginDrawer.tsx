"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

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
  /** Where to land after the session is issued; the OAuth leg carries it as `?next=`. */
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
  // No in-flight state to track. Every way out of this drawer is a full
  // navigation — the provider link leaves the origin, and its failure path
  // redirects back with `?error=`, remounting the tree either way. A `pending`
  // flag that gated dismissal would only be able to get stuck.
  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
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
            className="h-auto bg-[#03C75A] px-4 py-3 text-white hover:bg-[#03C75A] hover:brightness-95"
          />

          {initialError && (
            <Alert variant="destructive">
              <AlertDescription className="text-center">
                {initialError}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
