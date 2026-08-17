import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";

export const metadata = {
  title: "로그인 · 찜꽁",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">찜꽁</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          인스타그램·유튜브 링크를 붙여넣으면 장소를 찾아 지도에 저장합니다.
        </p>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
