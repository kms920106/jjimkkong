import { getMember } from "@/lib/auth";
import SettingsClient from "@/components/SettingsClient";
import { prisma } from "@/lib/prisma";

// Reads the session cookie, so this page is always rendered per request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "설정 · 찜꽁",
};

export default async function SettingsPage() {
  // Public like every other page: no redirect, no requireMember(). Signed out it
  // renders the rows that need no account (약관·개인정보처리방침) and disables
  // the rest — every write it could submit is 401 anyway.
  const member = await getMember();

  // Only used for the withdrawal dialog's "링크 N개" line, so it is counted
  // rather than fetched: the page renders no post.
  const savedCount = member
    ? await prisma.bookmark.count({
        where: { memberId: member.id, deletedAt: null },
      })
    : 0;

  return (
    <SettingsClient
      signedIn={member !== null}
      hasPassword={member?.passwordHash != null}
      savedCount={savedCount}
    />
  );
}
