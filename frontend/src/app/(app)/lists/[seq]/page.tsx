import { notFound } from "next/navigation";
import { getMember } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { liveList, placeListInclude, toPlaceListDTO } from "@/lib/place-list";
import { ListVisibility, MapProvider } from "@/generated/prisma/enums";
import ListDetailClient from "@/components/list/ListDetailClient";

/**
 * The owner's view of one of their lists.
 *
 * `requireMember()` is deliberately not used, in keeping with "pages render,
 * the API is the gate" — but unlike the other pages there is nothing to render
 * signed out, because this URL addresses a *specific member's* list by their
 * own per-member number. A signed-out visitor asking for `/lists/1` is asking
 * for a row that cannot be resolved without knowing whose it is, so this 404s
 * rather than rendering an empty shell.
 *
 * That is also why the query is scoped by `memberId`: this route must never
 * serve another member's list, and the public path for that is `/u/<id>/<seq>`
 * with its own visibility check.
 */
export default async function ListPage(
  props: PageProps<"/lists/[seq]">,
) {
  const member = await getMember();
  if (!member) notFound();

  const seq = Number((await props.params).seq);
  if (!Number.isInteger(seq) || seq < 1) notFound();

  const row = await prisma.placeList.findFirst({
    where: { memberId: member.id, memberSeq: seq, ...liveList },
    include: placeListInclude,
  });
  if (!row) notFound();

  const list = toPlaceListDTO(row);

  return (
    <ListDetailClient
      list={list}
      mapProvider={member.mapProvider ?? MapProvider.NAVER}
      owner
      // The owner is by definition signed in here — this page 404s without a
      // session — but the prop is passed explicitly rather than defaulted, so
      // the two questions stay visibly separate.
      viewerSignedIn
      // Offered only on a non-private list. Deliberately not a URL: the share
      // address does not exist until the owner presses the button, which is
      // what mints the token — see POST /api/lists/[seq]/share.
      sharable={list.visibility !== ListVisibility.PRIVATE}
      backHref="/lists"
    />
  );
}
