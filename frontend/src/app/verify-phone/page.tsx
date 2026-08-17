import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PhoneVerifyForm from "@/components/PhoneVerifyForm";
import {
  openPending,
  PENDING_BINDING_COOKIE,
  PENDING_COOKIE,
  RETURN_TO_COOKIE,
  safeReturnPath,
} from "@/lib/auth/pending";
import { normalizeKoreanMobile } from "@/lib/auth/phone";

export const metadata = {
  title: "휴대폰 인증 · 찜꽁",
};

// Reads cookies, so this page is always rendered per request.
export const dynamic = "force-dynamic";

/**
 * The phone leg of a social login, as its own page rather than a step in the
 * login drawer.
 *
 * Standing on its own is what lets it refuse to render at all: reaching it
 * without a pending login means the cookie expired or the URL was typed, and
 * there is nothing to verify against. Sending those visitors home beats showing
 * a form whose every submission can only 401.
 *
 * Every first sign-in lands here, including the ones where the provider already
 * handed us a number — that number is only ever a prefill, never a credential.
 */
export default async function VerifyPhonePage() {
  const store = await cookies();
  const pending = openPending(
    store.get(PENDING_COOKIE)?.value,
    store.get(PENDING_BINDING_COOKIE)?.value,
  );
  if (!pending) {
    redirect("/");
  }

  // Set by the OAuth start route from wherever the login drawer was opened, so
  // finishing here returns the user to the page they left.
  const returnTo = safeReturnPath(store.get(RETURN_TO_COOKIE)?.value);

  // Normalized here rather than handed over raw: providers disagree on format
  // (`010-1234-5678`, `+82 10-…`), and the form's input holds bare digits. A
  // number that does not normalize simply yields no prefill.
  const suggestedPhone = normalizeKoreanMobile(pending.profile.phone) ?? "";

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">휴대폰 인증</h1>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          계정을 안전하게 연결하기 위해 휴대폰 번호를 확인합니다. 하이픈(-) 없이
          숫자만 입력해 주세요.
        </p>
      </div>
      <PhoneVerifyForm redirectTo={returnTo} initialPhone={suggestedPhone} />
    </main>
  );
}
