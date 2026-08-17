import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PhoneVerifyForm from "@/components/PhoneVerifyForm";
import {
  openPending,
  PENDING_BINDING_COOKIE,
  PENDING_COOKIE,
} from "@/lib/auth/pending";

export const metadata = {
  title: "휴대폰 인증 · 찜꽁",
};

export default async function VerifyPage() {
  // Reaching this page without a pending login means the cookie expired or the
  // user typed the URL; there is nothing to verify against, so send them back
  // rather than showing a form that can only fail.
  const store = await cookies();
  const pending = openPending(
    store.get(PENDING_COOKIE)?.value,
    store.get(PENDING_BINDING_COOKIE)?.value,
  );
  if (!pending) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">휴대폰 인증</h1>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          계정을 안전하게 연결하기 위해 휴대폰 번호를 확인합니다.
        </p>
      </div>
      <PhoneVerifyForm />
    </main>
  );
}
