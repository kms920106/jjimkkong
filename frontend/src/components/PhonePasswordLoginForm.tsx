"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Signing in with a phone number and password. No SMS.
 *
 * Both fields are on screen at once, unlike the signup flow's steps: there is
 * nothing to wait for between them, and splitting them would only add a click. It
 * would also leak — advancing to a password field only for known numbers would tell
 * the visitor which numbers are registered, which the single generic error from the
 * server is careful to avoid.
 */
export default function PhonePasswordLoginForm({
  redirectTo,
  onSuccess,
  onForgotPassword,
  onError,
  onBusyChange,
}: {
  redirectTo: string;
  /** Lets the drawer close itself before a same-route navigation that would not unmount it. */
  onSuccess?: () => void;
  /** Switches the drawer over to the reset flow. */
  onForgotPassword: () => void;
  /** Clears any stale provider `?error=` message sitting above this form. */
  onError?: () => void;
  /** Lets the drawer refuse to be dismissed while a login is completing. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  // router.refresh() returns void and settles asynchronously; a transition is the
  // only way to observe when the refreshed RSC payload has actually been applied.
  const [refreshing, startRefresh] = useTransition();
  const [succeeded, setSucceeded] = useState(false);

  // Close the drawer on the transition's falling edge, not when the request
  // returned — that is the whole point: by now the refreshed RSC payload is on
  // the page, so `signedIn` is true and the menu button behind this drawer opens
  // the app menu rather than re-opening the login.
  //
  // An effect, not the render-phase adjustment used elsewhere in this file: both
  // callbacks set state in the *parent*, which React forbids during a child's
  // render. The one frame it costs is unobservable here — the drawer is mid-close
  // either way — whereas the adjustment logs a console error and is not
  // guaranteed to flush.
  const notified = useRef(false);
  useEffect(() => {
    if (refreshing || !succeeded || notified.current) return;
    notified.current = true;
    onBusyChange?.(false);
    onSuccess?.();
  }, [refreshing, succeeded, onBusyChange, onSuccess]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    // Tells the drawer to refuse dismissal until this settles. Reported from the
    // handler, not during render: setState on a *parent* while a child renders is
    // the one case React's render-phase adjustment pattern does not cover.
    onBusyChange?.(true);

    try {
      const response = await fetch("/api/auth/phone/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });

      if (!response.ok) {
        toast.error(await errorMessage(response, "로그인에 실패했습니다."));
        onError?.();
        setPending(false);
        onBusyChange?.(false);
        return;
      }

      // refresh() so the RSC cache is rebuilt with the new session cookie; without
      // it the destination renders from the cached logged-out tree.
      //
      // The drawer only closes once that refresh has landed. Closing first looks
      // faster but hands the user a page whose server props still say signed out:
      // the header's menu button reads `signedIn` and, for the ~2s until the new
      // tree arrives, re-opens this very drawer instead of the app menu.
      setSucceeded(true);
      startRefresh(() => {
        router.refresh();
        router.push(redirectTo);
      });
      // `pending` stays set on success: the navigation is in flight, and re-enabling
      // the button would allow a second submit against it.
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
      onError?.();
      setPending(false);
      onBusyChange?.(false);
    }
  }

  // One flag for the button: the request and the refresh that follows it are a
  // single wait from the user's side.
  const busy = pending || refreshing;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Label htmlFor="pw-login-phone">휴대폰 번호</Label>
      <Input
        id="pw-login-phone"
        name="phone"
        type="tel"
        inputMode="numeric"
        autoComplete="username"
        required
        value={phone}
        // Digits stripped as they are typed, so a pasted `010-1234-5678` quietly
        // becomes `01012345678`. The server normalizes again — convenience, not the
        // check.
        onChange={(event) =>
          setPhone(event.target.value.replace(/[^\d]/g, "").slice(0, 11))
        }
        maxLength={11}
        placeholder="01012345678"
        className="h-auto px-3 py-2.5 text-sm"
      />

      <Label htmlFor="pw-login-password">비밀번호</Label>
      <Input
        id="pw-login-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="h-auto px-3 py-2.5 text-sm"
      />

      <SubmitButton
        type="submit"
        disabled={busy || phone.length !== 11 || password.length === 0}
      >
        {busy ? "로그인 중…" : "로그인"}
      </SubmitButton>

      <Button
        type="button"
        variant="link"
        onClick={onForgotPassword}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        비밀번호를 잊으셨나요?
      </Button>
    </form>
  );
}
