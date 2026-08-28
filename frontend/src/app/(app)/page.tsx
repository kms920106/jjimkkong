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
        // Every state HomeClient seeds from props (`posts`, `mapProvider`) is
        // member-scoped, and useState ignores the prop after mount. The login
        // forms finish with router.refresh() + router.push("/"), and pushing to
        // the route you are already on refreshes the props *without*
        // remounting — so a visitor who logs in from the drawer rendered inside
        // HomeClient itself would keep the logged-out empty list and draw a map
        // with no pins. Keying on the member makes the login/logout boundary a
        // remount, which is the reset; see PostThumbnail's `key={src}` note for
        // the same "state goes stale unnoticed across a refresh" case, fixed by
        // the caller rather than by a sync effect (which
        // `react-hooks/set-state-in-effect` forbids).
        //
        // On HomeClient, not on the Suspense above it: keying the boundary
        // would re-trigger its fallback and flash the loading skeleton.
        key={member?.id ?? "anon"}
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
