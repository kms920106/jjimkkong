"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "phone" | "code";

/**
 * The second half of a social login. The number is what accounts are matched
 * on, and it has to be proven on this device, so every first sign-in comes
 * through here — including the ones where the provider already supplied a
 * number.
 *
 * A page rather than a step inside the login drawer: this is a checkpoint the
 * user must clear, and it needs the server-side pending-cookie check that only
 * a route can do. The drawer would have to render the form before knowing
 * whether there is anything to verify against.
 */
export default function PhoneVerifyForm({
  redirectTo,
  initialPhone = "",
}: {
  /** Where the login started, so finishing lands back there. */
  redirectTo: string;
  /**
   * The number the provider gave us, if any, as a starting value for the input.
   * Purely a typing shortcut — the user can replace it, and the SMS still has to
   * reach whatever number is submitted.
   */
  initialPhone?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    try {
      const response = await fetch("/api/auth/phone/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      if (!response.ok) {
        toast.error(await errorMessage(response, "인증번호를 보내지 못했습니다."));
        return;
      }

      const body = await response.json();
      toast.success(`${body.phone}로 인증번호를 보냈습니다.`);
      setStep("code");
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    try {
      const response = await fetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });

      if (!response.ok) {
        toast.error(await errorMessage(response, "인증에 실패했습니다."));
        // Only the failure paths clear `pending`. The success path navigates
        // away, and re-enabling the button during that navigation would let a
        // second submit fire against an already-consumed verification.
        setPending(false);
        return;
      }

      // refresh() first so the RSC cache is rebuilt with the new session
      // cookie; without it the destination would render from the cached
      // logged-out tree.
      router.refresh();
      router.push(redirectTo);
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
      setPending(false);
    }
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-4">
      {step === "phone" ? (
        <form onSubmit={sendCode} className="flex flex-col gap-3">
          <Label htmlFor="phone">휴대폰 번호</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            required
            autoFocus
            value={phone}
            // Digits only, stripped as they are typed rather than validated on
            // submit: the number is entered without hyphens, so a pasted
            // `010-1234-5678` should quietly become `01012345678` instead of
            // bouncing back an error the user has to fix by hand. The server
            // normalizes again regardless — this is a convenience, not the check.
            onChange={(event) =>
              setPhone(event.target.value.replace(/[^\d]/g, "").slice(0, 11))
            }
            maxLength={11}
            placeholder="01012345678"
            className="h-auto px-3 py-2.5 text-sm"
          />
          <SubmitButton type="submit" disabled={pending}>
            {pending ? "보내는 중…" : "인증번호 받기"}
          </SubmitButton>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="flex flex-col gap-3">
          <Label htmlFor="code">인증번호 6자리</Label>
          <Input
            id="code"
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
            {pending ? "확인 중…" : "인증하고 시작하기"}
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
    </div>
  );
}
