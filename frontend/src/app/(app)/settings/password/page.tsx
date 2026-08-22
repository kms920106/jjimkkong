import { getUser } from "@/lib/auth";
import PasswordSettingPageClient from "@/components/PasswordSettingPageClient";

// Reads the session cookie, so this page is always rendered per request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "비밀번호 변경 · 찜꽁",
};

export default async function PasswordSettingPage() {
  // Public like every other page: no redirect, no requireUser(). Signed out the
  // form is replaced by a prompt, and POST /api/settings/password is 401 anyway.
  const user = await getUser();

  return (
    <PasswordSettingPageClient
      signedIn={user !== null}
      hasPassword={user?.passwordHash != null}
    />
  );
}
