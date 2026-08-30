import { notFound } from "next/navigation";
import { getMember } from "@/lib/auth";
import { readPublicList } from "@/lib/place-list";
import { MapProvider } from "@/generated/prisma/enums";
import ListDetailClient from "@/components/list/ListDetailClient";

// Reads the session cookie (to decide the map provider), so this is rendered
// per request.
export const dynamic = "force-dynamic";

/**
 * A shared list, as anyone holding the URL sees it.
 *
 * This is the *discoverable* address, and it serves **PUBLIC lists only** —
 * `readPublicList()` puts that in the query's `where`, so a PRIVATE or
 * link-shared list is never read at all rather than fetched and hidden.
 *
 * A 일부 공개 list deliberately 404s here even though it is readable elsewhere.
 * The path is two small sequential integers, so answering would let anyone
 * enumerate other members' link-shared lists by counting — which is precisely
 * the "found by someone you never sent it to" that 일부 공개 promises against.
 * Those lists live at `/s/<token>` instead. Do not "fix" this by widening the
 * visibility filter.
 *
 * A missing, private, link-shared, or deleted list all answer the same 404.
 * Distinguishing them would turn this route into a probe for which lists a
 * member holds and which of those they have chosen not to publish — the same
 * reason `ListNotFoundError` maps to 404 rather than 403.
 */
export default async function SharedListPage(
  props: PageProps<"/u/[memberId]/[seq]">,
) {
  const params = await props.params;
  const memberId = Number(params.memberId);
  const seq = Number(params.seq);
  if (!Number.isInteger(memberId) || memberId < 1) notFound();
  if (!Number.isInteger(seq) || seq < 1) notFound();

  const list = await readPublicList(memberId, seq);
  if (!list) notFound();

  // The *viewer's* map preference, not the owner's: this page draws a map in
  // the viewer's browser, and which provider they prefer is their setting.
  // Signed out it falls back to the same default a new account starts on.
  const viewer = await getMember();

  return (
    <ListDetailClient
      list={list}
      mapProvider={viewer?.mapProvider ?? MapProvider.NAVER}
      // Never the owner here, even when the viewer happens to be them — the
      // owner's controls live on /lists/<seq>, which is the URL scoped to their
      // own numbering. Passing `owner` from a comparison of ids would put edit
      // buttons on a page whose PATCH target is addressed by the *caller's*
      // sequence, not this page's.
      owner={false}
      // The star on the place sheet saves into the *viewer's* own lists, which
      // is the point of reading someone else's shared list. Signed out it opens
      // the login drawer instead — never a silent no-op.
      viewerSignedIn={viewer !== null}
      sharable={false}
      backHref={`/u/${memberId}`}
    />
  );
}

export async function generateMetadata(
  props: PageProps<"/u/[memberId]/[seq]">,
) {
  const params = await props.params;
  const list = await readPublicList(
    Number(params.memberId),
    Number(params.seq),
  );
  // A private or missing list gets the generic title rather than one that
  // confirms it exists — the page 404s anyway, and metadata must not answer
  // what the page refuses to.
  return { title: list ? `${list.name} · 찜꽁` : "찜꽁" };
}
