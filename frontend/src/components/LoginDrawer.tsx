"use client";

import { useState } from "react";

import PhonePasswordLoginForm from "@/components/PhonePasswordLoginForm";
import PhoneSignupForm from "@/components/PhoneSignupForm";
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

/**
 * Which phone flow the drawer is showing. `reset` shares the signup form's
 * component — the steps are identical and only the copy and route prefix differ.
 */
type DrawerMode = "login" | "signup" | "reset";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where to land after the session is issued; the OAuth leg carries it as `?next=`. */
  redirectTo: string;
  /** Message from a `?error=` slug on the callback's failure redirect. */
  initialError?: string | null;
};

/**
 * The two ways in: a provider, or a phone number on its own.
 *
 * The provider leg only chooses a provider here. It leaves the origin, and a
 * social login that comes back continues on /verify-phone — a page rather than a
 * step in this drawer, because it has to be able to refuse to render when there
 * is no pending login to verify against.
 *
 * The phone leg runs to completion inside the drawer instead. It has no prior
 * credential to check, so there is nothing to refuse and no reason to take the
 * user off the page they were on, which is what this drawer exists to avoid.
 */
export default function LoginDrawer({
  open,
  onOpenChange,
  redirectTo,
  initialError = null,
}: Props) {
  // The provider leg tracks no in-flight state: every way out of it is a full
  // navigation — the link leaves the origin, and its failure path redirects back
  // with `?error=`, remounting the tree either way. A `pending` flag gating
  // dismissal could only get stuck.
  //
  // This one flag exists because the phone leg does *not* remount: a `?error=`
  // message from an earlier provider attempt would otherwise stay pinned beside a
  // phone form that has since raised its own error, showing two unrelated
  // failures as if they were one.
  //
  // Seeding state from a prop is only safe because `initialError` is a mount-time
  // constant by contract: HomeClient reads the slug once into its own
  // useState initializer and renders this drawer unconditionally, so the prop has
  // no later value to track. Make that upstream value reactive — re-reading
  // searchParams on navigation, say — and this silently starts showing a stale
  // message.
  const [providerError, setProviderError] = useState(initialError);

  // Which phone flow is on screen. Reset is reachable only from the login form's
  // "forgot password" link, so it is a mode rather than a top-level tab.
  const [mode, setMode] = useState<DrawerMode>("login");

  // The drawer's content stays mounted between opens (Base UI keeps it in the
  // tree for the close animation), so `mode` would otherwise still be "reset"
  // the next time this drawer opens after a password reset. Every open should
  // land back on the entry screen — reset during render (not an effect) on the
  // false→true edge, following React's "adjust state while rendering" pattern.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && mode !== "login") setMode("login");
  }

  // True from the moment a form's request goes out until the session is live on
  // the page behind this drawer. The forms own the flag because only they know
  // when their router.refresh() has actually landed.
  const [busy, setBusy] = useState(false);

  return (
    <Drawer
      open={open}
      // A login that has succeeded on the server but whose page has not caught up
      // yet must not be dismissable: closing there hands back a UI that still says
      // signed out, and the menu button re-opens this drawer instead of the app
      // menu. `disablePointerDismissal` covers the backdrop; every other route out
      // (swipe, Escape, the close button) arrives here as a reason we can refuse.
      // Programmatic closes carry `none`, so the form's own success close passes.
      onOpenChange={(next, details) => {
        if (!next && busy && details.reason !== "none") return;
        onOpenChange(next);
      }}
      disablePointerDismissal={busy}
      showSwipeHandle
    >
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader className="pb-4 text-center">
          <DrawerTitle>
            {mode === "reset" ? "비밀번호 재설정" : "로그인"}
          </DrawerTitle>
          <DrawerDescription>
            {mode === "reset"
              ? "휴대폰 인증 후 새 비밀번호를 설정합니다."
              : "링크를 저장하고 지도에서 다시 찾아보세요."}
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {/* The phone flows sit above the provider button because they are the
              paths that stay on this page: their inputs are the only thing here
              the user can act on without leaving, so they lead.

              Login and signup are separate choices rather than one adaptive form.
              Deciding automatically would mean answering "does this number have an
              account?" over HTTP before the caller has proven anything, and that
              answer is a membership oracle for any number — so the user states
              their intent instead, and every server response stays uniform. */}
          {mode === "login" ? (
            <PhonePasswordLoginForm
              redirectTo={redirectTo}
              onError={() => setProviderError(null)}
              onSuccess={() => onOpenChange(false)}
              onBusyChange={setBusy}
              onForgotPassword={() => setMode("reset")}
            />
          ) : (
            <PhoneSignupForm
              // Keyed on the mode so switching signup↔reset fully remounts instead
              // of reconciling. Same component and position otherwise, so React
              // would keep the previous flow's step and inputs — carrying a signup
              // challenge into a reset form, whose submit can only 401. The map
              // providers are keyed for exactly this reason.
              key={mode}
              mode={mode}
              redirectTo={redirectTo}
              onError={() => setProviderError(null)}
              onSuccess={() => onOpenChange(false)}
              onBusyChange={setBusy}
            />
          )}

          {/* The way back. Reset is reached from the login form's own link rather
              than from here, because it is a detour within signing in, not a third
              thing a visitor picks off the top level. */}
          <Button
            type="button"
            variant="link"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {mode === "login"
              ? "휴대폰 번호로 가입하기"
              : "이미 계정이 있어요 · 로그인"}
          </Button>

          {/* Naver 진입점은 임시로 숨김. 콜백·세션 로직은 그대로 두어 되돌리기 쉽게 한다. */}

          {/* Below its button, not above the form: this message belongs to the
              provider leg, and pinning it to the top would hang a Naver failure
              over a phone form that has nothing to do with it. */}
          {providerError && (
            <Alert variant="destructive">
              <AlertDescription className="text-center">
                {providerError}
              </AlertDescription>
            </Alert>
          )}

        </div>
      </DrawerContent>
    </Drawer>
  );
}
