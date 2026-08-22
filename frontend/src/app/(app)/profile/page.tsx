import { getUser } from "@/lib/auth";
import ProfileEditClient from "@/components/ProfileEditClient";

// Reads the session cookie, so this page is always rendered per request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "프로필 수정 · 찜꽁",
};

export default async function ProfilePage() {
  // Public like every other page: no redirect, no requireUser(). Signed out
  // this renders the form disabled with a prompt to sign in, and the PATCH it
  // would submit is 401 anyway — the API is the gate.
  const user = await getUser();

  return (
    <ProfileEditClient
      signedIn={user !== null}
      initial={{
        nickname: user?.nickname ?? null,
        statusMessage: user?.statusMessage ?? null,
        imageUrl: user?.imageUrl ?? null,
        email: user?.email ?? null,
      }}
    />
  );
}
