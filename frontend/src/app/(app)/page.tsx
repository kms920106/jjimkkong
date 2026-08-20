import { Suspense } from "react";
import { getUser } from "@/lib/auth";
import { maskedPhoneOf } from "@/lib/auth/phone-crypto";
import { prisma } from "@/lib/prisma";
import { savedPostInclude, toSavedPostDTO } from "@/lib/serialize";
import { MapProvider } from "@/generated/prisma/enums";
import HomeClient from "@/components/HomeClient";

// Reads the session cookie, so this page is always rendered per request.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Public: a logged-out visitor gets the map with no pins on it and a login
  // drawer behind the controls, rather than a redirect.
  const user = await getUser();

  const posts = user
    ? await prisma.savedPost.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: savedPostInclude,
      })
    : [];

  return (
    // HomeClient reads ?place= via useSearchParams, which Next requires to sit
    // under a Suspense boundary.
    <Suspense>
      <HomeClient
        initialPosts={posts.map(toSavedPostDTO)}
        // Signed out there is no stored preference, so the map falls back to
        // the same default a new account starts on.
        profile={
          user
            ? {
                nickname: user.nickname,
                email: user.email,
                phoneMasked: maskedPhoneOf(user),
                mapProvider: user.mapProvider,
                // The flag, never the verifier — it only picks the wording of the
                // settings row.
                hasPassword: user.passwordHash !== null,
              }
            : {
                nickname: null,
                email: null,
                phoneMasked: null,
                mapProvider: MapProvider.NAVER,
                hasPassword: false,
              }
        }
        signedIn={user !== null}
      />
    </Suspense>
  );
}
