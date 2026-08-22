"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";

/**
 * `current` is skipped entirely when the account has no password to prove, so a
 * first set is a single screen rather than an empty one followed by the real one.
 */
type Step = "current" | "next";

/**
 * The design's field: a full-width box with a hairline border, taller and squarer
 * than the app's default `Input`, and a grey placeholder that reads as instruction
 * rather than example text.
 */
const FIELD = "h-auto rounded-[4px] border-input px-4 py-4 text-sm";

/**
 * The design's submit button, and the reason it is a plain <button> rather than
 * our `Button`.
 *
 * Its two states are the whole affordance of these screens: muted rose while the
 * form is incomplete, saturated crimson the moment it can be submitted. `Button`
 * expresses "not ready" as `disabled:opacity-50` over the primary colour, which
 * on this near-black primary reads as grey — the design's rose is a different
 * colour, not a faded one, so a variant would have to override the disabled
 * treatment as well as the fill, radius, height and width. At that point the
 * variant is this string with extra indirection.
 *
 * The crimson is literal because the theme has no token for it: `--primary` is
 * near-black and `--destructive` is the error red, which this is not — it is the
 * brand's affirmative colour and reusing the error token would make every future
 * destructive restyle move this button too.
 */
const SUBMIT =
  "w-full rounded-[4px] py-4 text-base font-medium text-white transition-colors " +
  "bg-[#D98D8D] enabled:bg-[#C8001E] enabled:hover:bg-[#AE001A] " +
  "disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-[#C8001E]";

/**
 * Setting or changing the password on the signed-in account.
 *
 * Two screens: prove the current password, then type the new one twice. The first
 * screen is what stands between a borrowed session and a permanent credential — a
 * session alone must never be enough to mint one, because that converts temporary
 * access into access the owner does not know about. An account with no password
 * has nothing to prove, so it starts on the second screen.
 *
 * The current password is checked by its own request before the user is shown the
 * new-password screen. Deferring it to the final save would make the user type a
 * new password twice before learning the first screen was wrong, and the failure
 * message could not say which field was at fault. The final save re-checks it
 * anyway — this screen is a pre-check, not a grant.
 *
 * SMS is deliberately absent. It gates the paths where the caller has no password
 * to prove: `/api/auth/phone/reset/*` for a forgotten one, and first login.
 */
export default function PasswordSettingForm({
  hasPassword,
  onDone,
}: {
  /** Also decides whether the flow has a first screen at all. */
  hasPassword: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(hasPassword ? "current" : "next");
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

  async function verifyCurrent(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    const response = await post("/api/settings/password/verify", {
      currentPassword,
    });
    setPending(false);
    if (!response) return;
    if (!response.ok) {
      toast.error(
        await errorMessage(response, "현재 비밀번호를 확인하지 못했습니다."),
      );
      return;
    }
    setStep("next");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (password !== passwordConfirm) {
      toast.error("비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    setPending(true);

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

    toast.success("비밀번호를 변경했습니다.");
    // `pending` deliberately stays set: onDone() unmounts this form, and clearing
    // it first would re-enable the button while router.refresh() is still in
    // flight, letting a fast second click submit the same change again.
    router.refresh();
    onDone();
  }

  if (step === "current") {
    return (
      <form onSubmit={verifyCurrent} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="setting-current-password" className="text-sm">
            현재 비밀번호
          </Label>
          <Input
            id="setting-current-password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="현재 비밀번호를 입력해주세요."
            className={FIELD}
          />
        </div>
        <button
          type="submit"
          disabled={pending || currentPassword.length === 0}
          className={SUBMIT}
        >
          확인
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="setting-password" className="text-sm">
          새 비밀번호
        </Label>
        <Input
          id="setting-password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="새 비밀번호를 입력해주세요."
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="setting-password-confirm" className="text-sm">
          새 비밀번호 확인
        </Label>
        <Input
          id="setting-password-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={passwordConfirm}
          onChange={(event) => setPasswordConfirm(event.target.value)}
          placeholder="새 비밀번호를 확인해주세요."
          className={FIELD}
        />
      </div>

      {/* Enabled only once both fields could succeed — the design has no inline
          error text, so the button's own state is the only thing telling the user
          the form is not yet complete. The mismatch case still needs the check in
          save(), since two different long-enough values pass this test. */}
      <button
        type="submit"
        disabled={
          pending ||
          password.length < MIN_PASSWORD_LENGTH ||
          passwordConfirm.length === 0
        }
        className={SUBMIT}
      >
        확인
      </button>
    </form>
  );
}
