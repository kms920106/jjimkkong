import { notFound } from "next/navigation";
import { getMember } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MapProvider } from "@/generated/prisma/enums";
import { bookmarkInclude, toSavedPostDTO } from "@/lib/serialize";
import PostMapClient from "@/components/PostMapClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "지도 · 찜꽁",
};

/**
 * One post's places on a map of their own, opened from a place card on
 * /links/[id].
 *
 * A page rather than a jump to the home map, which is where the place cards
 * used to send the user. The home map draws *every* pin they have saved, so a
 * post's own route — the point of tapping one of its places — arrived buried
 * among unrelated links, and there was no way back but the browser's own
 * button. Here the pins are only this post's, and the header carries a back
 * arrow to the post.
 *
 * Nested under the bookmark rather than a top-level /map so the ownership check
 * is the same one /links/[id] already does, and so back leads somewhere: the
 * post this map belongs to.
 *
 * `deletedAt: null` is one of the read filters the root AGENTS.md lists as
 * moving together — without it a deleted link's map stays readable at its own
 * URL, which is the same bug as the detail page staying open.
 */
export default async function PostMapPage({
  params,
  searchParams,
}: PageProps<"/links/[id]/map">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const member = await getMember();
  if (!member) notFound();

  // Parsed rather than passed through, for the reason /links/[id] records: the
  // segment is free text, and a non-numeric or out-of-range value has to become
  // a 404 instead of reaching Prisma as a malformed Int. `Number.parseInt`
  // would accept "1abc"; this does not.
  const memberSeq = Number(id);
  if (!Number.isInteger(memberSeq) || memberSeq < 1) notFound();

  const bookmark = await prisma.bookmark.findFirst({
    where: { memberId: member.id, memberSeq, deletedAt: null },
    include: bookmarkInclude,
  });
  if (!bookmark) notFound();

  const post = toSavedPostDTO(bookmark);

  /**
   * Which place's card opens on arrival.
   *
   * Read here rather than from `useSearchParams` in the client, and the reason
   * is not the Suspense boundary that reading it there would need — it is that
   * only the server can tell whether the id is one of *this post's* places.
   * Without that check `?place=<some other post's place>` renders a map whose
   * card silently never opens, which reads to the user as the place card being
   * broken, and it answers whether an arbitrary Place row exists.
   *
   * An id that is not in this post is dropped rather than a 404: the map of the
   * post is still a valid page, and a place can legitimately vanish from it if
   * the row was merged. Comma-separated because a whole post's places may be
   * asked for at once, matching the home map's `?place=` — only the first opens
   * a card, but every valid one frames the camera.
   */
  const ownPlaceIds = new Set(post.places.map((place) => place.id));
  const requestedPlaceIds = (typeof query.place === "string" ? query.place : "")
    .split(",")
    .filter(Boolean)
    .map(Number)
    .filter((placeId) => Number.isInteger(placeId) && ownPlaceIds.has(placeId));

  return (
    <PostMapClient
      post={post}
      requestedPlaceIds={requestedPlaceIds}
      mapProvider={member.mapProvider ?? MapProvider.NAVER}
    />
  );
}
