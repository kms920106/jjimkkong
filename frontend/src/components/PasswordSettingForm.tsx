"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";

type Step = "phone" | "code" | "password";

/**
 * Setting or changing the password from the settings drawer, for an account that
 * signed in some other way.
 *
 * Re-proves the number by SMS even though the user is already signed in. A session
 * is the wrong gate for creating a credential: a borrowed or stolen one could
 * otherwise plant a password and turn temporary access into permanent access the
 * owner does not know about. The server enforces this — POST /api/settings/password
 * requires both a session and a verified challenge, and checks that the proven
 * number is the one on the account.
 *
 * Uses the `reset` SMS routes rather than a third intent, because the user-facing
 * action is identical: prove the number, then set a password.
 */
export default function PasswordSettingForm({
  hasPassword,
  phoneMasked,
  onDone,
}: {
  /** Only picks the wording; both cases perform the same write. */
  hasPassword: boolean;
  /** Shown so the user knows which number the code is going to. */
  phoneMasked: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [pending, setPending] = useState(false);

  async function post(url: string, body: unknown): Promise<Response | null> {
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
      return null;
    }
  }

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    const response = await post("/api/auth/phone/reset/send", { phone });
    setPending(false);
    if (!response) return;
    if (!response.ok) {
      toast.error(await errorMessage(response, "인증번호를 보내지 못했습니다."));
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

    const response = await post("/api/auth/phone/reset/verify", { phone, code });
    setPending(false);
    if (!response) return;
    if (!response.ok) {
      toast.error(await errorMessage(response, "인증에 실패했습니다."));
      return;
    }
    setStep("password");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (password !== passwordConfirm) {
      toast.error("비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    setPending(true);

    // The settings route, not the reset one: this account already has a session and
    // must keep it, whereas the reset route revokes every session for the account.
    const response = await post("/api/settings/password", {
      password,
      // Only meaningful when a password already exists; the server ignores it
      // otherwise and requires it when it does.
      ...(hasPassword ? { currentPassword } : {}),
    });
    if (!response) {
      setPending(false);
      return;
    }
    if (!response.ok) {
      toast.error(await errorMessage(response, "비밀번호를 설정하지 못했습니다."));
      setPending(false);
      return;
    }

    // `pending` deliberately stays set: onDone() unmounts this form, and clearing it
    // first would re-enable the button while router.refresh() is still in flight —
    // a fast second click would then submit against an already-spent SMS proof and
    // replace a success with "휴대폰 인증이 필요합니다".
    router.refresh();
    onDone();
  }

  return (
    <div className="flex flex-col gap-3">
      {step === "phone" && (
        <form onSubmit={sendCode} className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {hasPassword
              ? "비밀번호를 변경하려면 휴대폰 인증이 필요합니다."
              : "비밀번호를 설정하려면 휴대폰 인증이 필요합니다."}
            {phoneMasked ? ` (등록된 번호: ${phoneMasked})` : ""}
          </p>
          <Label htmlFor="setting-phone">휴대폰 번호</Label>
          <Input
            id="setting-phone"
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
          <Button
            type="submit"
            disabled={pending || phone.length !== 11}
            className="h-auto px-4 py-3"
          >
            {pending ? "보내는 중…" : "인증번호 받기"}
          </Button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode} className="flex flex-col gap-3">
          <Label htmlFor="setting-code">인증번호 6자리</Label>
          <Input
            id="setting-code"
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
          <Button
            type="submit"
            disabled={pending || code.length !== 6}
            className="h-auto px-4 py-3"
          >
            {pending ? "확인 중…" : "인증번호 확인"}
          </Button>
          {/* Without this a mistyped number is a dead end — the only way out would
              be closing the drawer, and the send budget would already be spent. */}
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
        <form onSubmit={save} className="flex flex-col gap-3">
          {/* Only when replacing one. An SMS proof alone cannot distinguish the owner
              from someone holding a stolen session — they could obtain a proof for a
              number they control through the public reset flow — so a change also
              requires knowing the existing password. A first set has nothing to
              know. */}
          {hasPassword && (
            <>
              <Label htmlFor="setting-current-password">현재 비밀번호</Label>
              <Input
                id="setting-current-password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="h-auto px-3 py-2.5 text-sm"
              />
            </>
          )}

          <Label htmlFor="setting-password">새 비밀번호</Label>
          <Input
            id="setting-password"
            type="password"
            autoComplete="new-password"
            required
            // Focused only when it is the first field; the current-password input
            // above takes focus when a password already exists.
            autoFocus={!hasPassword}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={`${MIN_PASSWORD_LENGTH}자 이상`}
            className="h-auto px-3 py-2.5 text-sm"
          />
          <Label htmlFor="setting-password-confirm">새 비밀번호 확인</Label>
          <Input
            id="setting-password-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
            className="h-auto px-3 py-2.5 text-sm"
          />
          <Button
            type="submit"
            disabled={
              pending ||
              password.length < MIN_PASSWORD_LENGTH ||
              (hasPassword && currentPassword.length === 0)
            }
            className="h-auto px-4 py-3"
          >
            {pending ? "저장 중…" : "비밀번호 저장"}
          </Button>
        </form>
      )}
    </div>
  );
}
