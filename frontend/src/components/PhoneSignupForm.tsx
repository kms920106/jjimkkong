"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";

type Step = "phone" | "code" | "password";

/** Which flow this form is driving. Chooses the route prefix and the copy. */
export type PhoneSignupMode = "signup" | "reset";

const COPY: Record<
  PhoneSignupMode,
  { submit: string; passwordLabel: string; done: string }
> = {
  signup: {
    submit: "가입하고 시작하기",
    passwordLabel: "비밀번호",
    done: "가입이 완료되었습니다.",
  },
  reset: {
    submit: "비밀번호 변경하기",
    passwordLabel: "새 비밀번호",
    done: "비밀번호가 변경되었습니다.",
  },
};

/**
 * Number → SMS code → password, for both signing up and resetting a password.
 *
 * One component for both because the steps, the validation, and the error handling
 * are identical — only the route prefix and two strings differ. The server keeps
 * them apart where it matters: the challenge cookie carries an intent, and a code
 * minted to create an account cannot complete a reset.
 *
 * The password step is where the account is actually created (signup) or changed
 * (reset), and it is the only step that issues a session. Verifying the code does
 * not sign anyone in — a session before the password exists would be access without
 * the credential being set.
 */
export default function PhoneSignupForm({
  mode,
  redirectTo,
  onSuccess,
  onError,
  onBusyChange,
}: {
  mode: PhoneSignupMode;
  redirectTo: string;
  onSuccess?: () => void;
  onError?: () => void;
  /** Lets the drawer refuse to be dismissed while a signup/reset is completing. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [pending, setPending] = useState(false);
  // router.refresh() returns void and settles asynchronously; a transition is the
  // only way to observe when the refreshed RSC payload has actually been applied.
  // See the login form — the drawer must not close before then.
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

  const copy = COPY[mode];
  const base = `/api/auth/phone/${mode}`;

  function fail(message: string) {
    toast.error(message);
    onError?.();
  }

  async function post(path: string, body: unknown): Promise<Response | null> {
    try {
      return await fetch(`${base}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      fail("네트워크 오류가 발생했습니다.");
      return null;
    }
  }

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    const response = await post("send", { phone });
    setPending(false);
    if (!response) return;

    if (!response.ok) {
      fail(await errorMessage(response, "인증번호를 보내지 못했습니다."));
      return;
    }
    const body = await response.json();
    toast.success(
      typeof body?.phone === "string"
        ? `${body.phone}로 인증번호를 보냈습니다.`
        : "인증번호를 보냈습니다.",
    );
    setStep("code");
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    const response = await post("verify", { phone, code });
    setPending(false);
    if (!response) return;

    if (!response.ok) {
      fail(await errorMessage(response, "인증에 실패했습니다."));
      return;
    }
    setStep("password");
  }

  async function setNewPassword(event: React.FormEvent) {
    event.preventDefault();
    if (password !== passwordConfirm) {
      fail("비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    setPending(true);
    // See the login form: reported from the handler, never during render.
    onBusyChange?.(true);

    const response = await post("password", { password });
    if (!response) {
      setPending(false);
      onBusyChange?.(false);
      return;
    }

    if (!response.ok) {
      fail(await errorMessage(response, "비밀번호를 설정하지 못했습니다."));
      // 409 means the number already has a password. signup/verify normally
      // catches that before a proof is minted, so reaching it here means the
      // account gained one between the two requests — and by now the proof is
      // spent, making this step a dead end that can only 401 from now on. Go back
      // to the number field so the message the user just read is actionable.
      if (response.status === 409) {
        setStep("phone");
        setCode("");
      }
      setPending(false);
      onBusyChange?.(false);
      return;
    }

    setSucceeded(true);
    startRefresh(() => {
      router.refresh();
      router.push(redirectTo);
    });
    // `pending` deliberately stays set — see the login form.
  }

  // The request and the refresh that follows it are one wait from the user's side.
  const busy = pending || refreshing;

  return (
    <div className="flex flex-col gap-3">
      {step === "phone" && (
        <form onSubmit={sendCode} className="flex flex-col gap-3">
          <Label htmlFor={`${mode}-phone`}>휴대폰 번호</Label>
          <Input
            id={`${mode}-phone`}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            required
            value={phone}
            onChange={(event) =>
              setPhone(event.target.value.replace(/[^\d]/g, "").slice(0, 11))
            }
            maxLength={11}
            placeholder="01012345678"
            className="h-auto px-3 py-2.5 text-sm"
          />
          <SubmitButton type="submit" disabled={pending || phone.length !== 11}>
            {pending ? "보내는 중…" : "인증번호 받기"}
          </SubmitButton>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode} className="flex flex-col gap-3">
          <Label htmlFor={`${mode}-code`}>인증번호 6자리</Label>
          <Input
            id={`${mode}-code`}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/[^\d]/g, ""))
            }
            placeholder="000000"
            className="h-auto px-3 py-2.5 text-center text-lg tracking-[0.4em] md:text-lg"
          />
          <SubmitButton type="submit" disabled={pending || code.length !== 6}>
            {pending ? "확인 중…" : "인증번호 확인"}
          </SubmitButton>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setStep("phone");
              setCode("");
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            번호 다시 입력하기
          </Button>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={setNewPassword} className="flex flex-col gap-3">
          <Label htmlFor={`${mode}-password`}>{copy.passwordLabel}</Label>
          <Input
            id={`${mode}-password`}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={`${MIN_PASSWORD_LENGTH}자 이상`}
            className="h-auto px-3 py-2.5 text-sm"
          />
          <Label htmlFor={`${mode}-password-confirm`}>
            {copy.passwordLabel} 확인
          </Label>
          <Input
            id={`${mode}-password-confirm`}
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            required
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
            className="h-auto px-3 py-2.5 text-sm"
          />
          {/* Only signup gates on this — a reset doesn't create an account, so
              there is nothing new to consent to. Plain anchors, not <Link>:
              this drawer is about to leave via a full page navigation either
              way, so a prefetching client transition buys nothing here. */}
          {mode === "signup" && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={agreedToTerms}
                onCheckedChange={(checked) => setAgreedToTerms(checked)}
                className="mt-0.5"
              />
              <span>
                <a
                  href="/terms"
                  target="_blank"
                  className="underline underline-offset-2"
                >
                  이용약관
                </a>
                과{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  className="underline underline-offset-2"
                >
                  개인정보처리방침
                </a>
                에 동의합니다.
              </span>
            </label>
          )}

          <SubmitButton
            type="submit"
            // Length is checked here only to disable the button early; the server
            // enforces the policy and returns its own Korean message.
            disabled={
              busy ||
              password.length < MIN_PASSWORD_LENGTH ||
              (mode === "signup" && !agreedToTerms)
            }
          >
            {busy ? "설정 중…" : copy.submit}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
