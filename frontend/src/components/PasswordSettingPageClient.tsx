"use client";

import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SettingsHeader } from "@/components/SettingsHeader";
import PasswordSettingForm from "@/components/PasswordSettingForm";

/**
 * Page chrome around `PasswordSettingForm`, which used to unfold inline inside
 * the settings drawer.
 *
 * It is a page now for the same reason `/profile` is: the form is a two-screen
 * flow with a password manager in the middle of it. A panel that unmounts —
 * because the browser's autofill sheet took focus, or the user switched apps to
 * read a password out of one — takes the first screen's progress with it, and
 * that progress cost the user a round trip to the server. A URL they can return
 * to does not.
 *
 * The back link and `onDone` both land on `/settings` rather than home — this
 * screen is only ever reached from there, so that is where the user was.
 */
export default function PasswordSettingPageClient({
  signedIn,
  hasPassword,
}: {
  signedIn: boolean;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const title = hasPassword ? "비밀번호 변경" : "비밀번호 설정";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <SettingsHeader
        href="/settings"
        ariaLabel="설정으로 돌아가기"
        title={title}
      />

      <div className="flex flex-col gap-6 px-4">
        {signedIn ? (
          <PasswordSettingForm
            hasPassword={hasPassword}
            // The form already called router.refresh() before this fires, so the
            // settings list it returns to shows 변경 rather than 설정 straight away.
            onDone={() => router.push("/settings")}
          />
        ) : (
          <Alert>
            <AlertDescription>
              로그인한 뒤에 비밀번호를 설정할 수 있습니다.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
