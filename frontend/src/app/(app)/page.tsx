import { Suspense } from "react";
import { getMember } from "@/lib/auth";
import { maskedPhoneOf } from "@/lib/auth/phone-crypto";
import { prisma } from "@/lib/prisma";
import { bookmarkInclude, toSavedPostDTO } from "@/lib/serialize";
import { MapProvider } from "@/generated/prisma/enums";
import HomeClient from "@/components/HomeClient";

// Reads the session cookie, so this page is always rendered per request.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Public: a logged-out visitor gets the map with no pins on it and a login
  // drawer behind the controls, rather than a redirect.
  const member = await getMember();

  const posts = member
    ? await prisma.bookmark.findMany({
        where: { memberId: member.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: bookmarkInclude,
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
          member
            ? {
                nickname: member.nickname,
                statusMessage: member.statusMessage,
                imageUrl: member.imageUrl,
                email: member.email,
                phoneMasked: maskedPhoneOf(member),
                mapProvider: member.mapProvider,
                // The flag, never the verifier — it only picks the wording of the
                // settings row.
                hasPassword: member.passwordHash !== null,
              }
            : {
                nickname: null,
                statusMessage: null,
                imageUrl: null,
                email: null,
                phoneMasked: null,
                mapProvider: MapProvider.NAVER,
                hasPassword: false,
              }
        }
        signedIn={member !== null}
      />
    </Suspense>
  );
}
