import { notFound } from "next/navigation";
import { getMember } from "@/lib/auth";
import { readListByShareToken } from "@/lib/place-list";
import { MapProvider } from "@/generated/prisma/enums";
import ListDetailClient from "@/components/list/ListDetailClient";

// Reads the session cookie (to decide the map provider), so this is rendered
// per request.
export const dynamic = "force-dynamic";

/**
 * A list opened through the link its owner shared.
 *
 * **This address exists so that "일부 공개" can mean what it says.** The token is
 * minted the first time the owner presses 공유, so a list they set to 일부 공개
 * and never shared has no token and therefore no reachable URL at all — the
 * rule is enforced by the address not existing, not by a check that could be
 * forgotten.
 *
 * It is also why the discoverable path `/u/<memberId>/<seq>` serves PUBLIC
 * lists only: that path is two small sequential integers, and a link-shared
 * list answering there would be enumerable by counting.
 *
 * `readListByShareToken()` re-reads `visibility` on every request, so flipping
 * a list back to 비공개 kills every link already handed out. A bad, revoked, or
 * since-privated token all answer the same 404 — distinguishing them would
 * confirm which tokens once existed.
 */
export default async function SharedListPage(props: PageProps<"/s/[token]">) {
  const { token } = await props.params;
  const list = await readListByShareToken(token);
  if (!list) notFound();

  // The *viewer's* map preference, not the owner's: this page draws a map in
  // the viewer's browser. Signed out it falls back to the same default a new
  // account starts on.
  const viewer = await getMember();

  return (
    <ListDetailClient
      list={list}
      mapProvider={viewer?.mapProvider ?? MapProvider.NAVER}
      // Never the owner here, even when the viewer happens to be them — the
      // owner's controls live on /lists/<seq>, the URL scoped to their own
      // numbering, and this page's PATCH target would be addressed by the
      // caller's sequence rather than this list's.
      owner={false}
      // The star saves the tapped place into the *viewer's* own lists, which is
      // the point of reading someone else's shared list. Signed out it opens
      // the login drawer rather than doing nothing.
      viewerSignedIn={viewer !== null}
      sharable={false}
      // Home, not the owner's public index: a 일부 공개 list is not listed there,
      // so sending the viewer to `/u/<id>` would offer a page that either 404s
      // or conspicuously fails to contain the list they are looking at.
      backHref="/"
    />
  );
}

export async function generateMetadata(props: PageProps<"/s/[token]">) {
  const { token } = await props.params;
  const list = await readListByShareToken(token);
  // An unresolvable token gets the generic title rather than one that confirms
  // a list ever existed behind it — the page 404s, and metadata must not answer
  // what the page refuses to.
  return { title: list ? `${list.name} · 찜꽁` : "찜꽁" };
}
