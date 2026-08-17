"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "phone" | "code";

/** Reads the API's Korean error message, falling back when the body is not JSON. */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The second half of a social login, shown when the provider did not give us a
 * phone number. The number is what accounts are matched on, so the login
 * cannot complete without one.
 */
export default function PhoneVerifyForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/auth/phone/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      if (!response.ok) {
        setError(await errorMessage(response, "인증번호를 보내지 못했습니다."));
        return;
      }

      const body = await response.json();
      setNotice(`${body.phone}로 인증번호를 보냈습니다.`);
      setStep("code");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });

      if (!response.ok) {
        setError(await errorMessage(response, "인증에 실패했습니다."));
        return;
      }

      router.refresh();
      router.push("/");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
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
            onChange={(event) => setPhone(event.target.value)}
            placeholder="010-1234-5678"
            className="h-auto px-3 py-2.5 text-sm"
          />
          <Button type="submit" disabled={pending} className="h-auto px-4 py-3">
            {pending ? "보내는 중…" : "인증번호 받기"}
          </Button>
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
          <Button
            type="submit"
            disabled={pending || code.length !== 6}
            className="h-auto px-4 py-3"
          >
            {pending ? "확인 중…" : "인증하고 시작하기"}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
              setNotice(null);
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            번호 다시 입력하기
          </Button>
        </form>
      )}

      {notice && (
        <Alert>
          <AlertDescription className="text-center">{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-center">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
