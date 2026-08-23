import { notFound } from "next/navigation";
import { getMember } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MapProvider } from "@/generated/prisma/enums";
import { bookmarkInclude, toSavedPostDTO } from "@/lib/serialize";
import PostDetailClient from "@/components/PostDetailClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "링크 · 찜꽁",
};

/**
 * One bookmark, opened from the /links grid.
 *
 * **The `[id]` segment is the member's own bookmark number, not a row id.**
 * `/links/1` is their first save. Per-member rather than a global counter
 * because a global one in the URL would publish how many links the service
 * holds and let anyone probe by id whether a given post exists — see the
 * Bookmark model. The shared `Post.id` never appears in a URL at all; it is an
 * internal key and the dedupe key for ingest.
 *
 * The lookup is one query, not two: the bookmark and everything the platform
 * published come back together through `bookmarkInclude`. Resolving the seq to
 * an id and then fetching the post separately would be an extra serial round
 * trip, and fetching it over HTTP from a server component would be worse still —
 * the session cookie does not ride along, so the app would get a login page back
 * where it expected JSON.
 *
 * Unlike the pages listed in (app)/AGENTS.md this one *does* 404 for a signed
 * out visitor, and that is not an exception to "pages open without a login" —
 * there is simply no row to render. The bookmark is scoped to its owner, so a
 * caller without a session has no `memberId` to query by, exactly as the home
 * map has no pins. What it must never do is redirect to a login.
 *
 * `deletedAt: null` is one of the read filters the root AGENTS.md lists as
 * moving together — without it a deleted link stays readable at its own URL.
 */
export default async function PostDetailPage({
  params,
}: PageProps<"/links/[id]">) {
  const { id } = await params;
  const member = await getMember();
  if (!member) notFound();

  // Parsed rather than passed through: the segment is free text, and a
  // non-numeric or out-of-range value has to become a 404 instead of reaching
  // Prisma as a malformed Int. `Number.parseInt` would accept "1abc"; this does
  // not.
  const memberSeq = Number(id);
  if (!Number.isInteger(memberSeq) || memberSeq < 1) notFound();

  const bookmark = await prisma.bookmark.findFirst({
    where: { memberId: member.id, memberSeq, deletedAt: null },
    include: bookmarkInclude,
  });
  if (!bookmark) notFound();

  return (
    <PostDetailClient
      post={toSavedPostDTO(bookmark)}
      // Not on SavedPostDTO: only this page renders it, and putting it in the
      // shared DTO would ship every caption to the grid, which shows none.
      // Comes off the shared Post — the caption is what the creator wrote, so
      // every member who saved this link reads the same one.
      caption={bookmark.post.caption}
      mapProvider={member.mapProvider ?? MapProvider.NAVER}
    />
  );
}
