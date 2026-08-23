import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getMember } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bookmarkInclude, toSavedPostDTO } from "@/lib/serialize";
import { AuthorAvatar } from "@/components/AuthorLink";
import { PostGrid } from "@/components/PostGrid";
import { SettingsHeader } from "@/components/SettingsHeader";
import { Button } from "@/components/ui/button";
import { authorProfileUrl } from "@/lib/author-profile-url";
import { platformLabel } from "@/lib/platform-labels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "작성자 · 찜꽁",
};

/**
 * Everything this member has bookmarked from one author.
 *
 * **The author is now a row, so the URL is `/author/1`.** It used to be
 * `/links/author/<handle>?platform=INSTAGRAM`: the handle had to be
 * percent-encoded because a YouTube "author" is a channel *title* — free text
 * with spaces and Korean in it — and `platform` had to ride in the query string
 * because a handle is only unique within its platform, so a page that mixed two
 * platforms would present two people as one. Both problems were the absence of
 * an identifier. `Author` has one, `[platform, handle]` is unique on the row,
 * and the URL is now short and unambiguous.
 *
 * The old route is gone rather than redirected. Every author link in this app is
 * built by AuthorLink from data the server just sent, so there was nothing
 * outside the app holding the old form.
 *
 * Like /links/[id] it 404s for a signed out visitor, and for the same reason
 * that is not an exception to "pages open without a login": the listing is
 * scoped to the caller's own bookmarks, so without a session there is no
 * `memberId` to query by and therefore nothing to render. What it must never do
 * is redirect to a login.
 *
 * `deletedAt: null` is one of the read filters the root AGENTS.md lists as
 * moving together — without it a deleted link would still be listed here even
 * though it has vanished from the grid it was deleted in. It also matters for
 * the 404 below: with the last bookmark deleted this URL must die, not linger.
 */
export default async function AuthorPostsPage({
  params,
}: PageProps<"/author/[id]">) {
  const { id } = await params;

  // Parsed rather than passed through, exactly as /links/[id] does: the segment
  // is free text and a non-numeric value has to become a 404 instead of reaching
  // Prisma as a malformed Int.
  const authorId = Number(id);
  if (!Number.isInteger(authorId) || authorId < 1) notFound();

  const member = await getMember();
  if (!member) notFound();

  const author = await prisma.author.findUnique({ where: { id: authorId } });
  if (!author) notFound();

  // Filtered through the join rather than on a denormalized column: the handle
  // used to sit on every saved row, so this was a plain `where: { author }`.
  // Now the author hangs off the shared Post and this listing is still the
  // member's own bookmarks, which is what keeps it scoped.
  const bookmarks = await prisma.bookmark.findMany({
    where: { memberId: member.id, deletedAt: null, post: { authorId } },
    orderBy: { createdAt: "desc" },
    include: bookmarkInclude,
  });

  // An author with nothing bookmarked is a URL for a person this member never
  // saved from — there is no page to show, so it is a 404 rather than an empty
  // grid that would look like the posts had been deleted. The Author row itself
  // may well exist because *another* member saved them; that is not this
  // member's page.
  if (bookmarks.length === 0) notFound();

  const dtos = bookmarks.map(toSavedPostDTO);

  // Off the author row now, rather than hunted for across the newest post that
  // happened to have one. That search existed because the avatar was copied onto
  // every saved row and they could disagree; one row per author ends it.
  const profileUrl = authorProfileUrl(author.handle, author.platform);

  return (
    <div className="flex w-full flex-col pb-8">
      {/* Back to the grid, not to the post that linked here: the author page is
          a listing, so the listing it belongs beside is the natural parent. The
          browser's own back gesture still returns to the post. */}
      <SettingsHeader href="/links" ariaLabel="링크 목록으로" title="작성자" />

      <section className="flex flex-col items-center gap-3 px-4 py-6">
        <AuthorAvatar author={author.handle} authorImage={author.image} className="size-20" />

        <div className="flex flex-col items-center gap-1">
          <h2 className="text-lg font-medium break-all">{author.handle}</h2>
        </div>

        {/* Only when we can name the account with certainty — see
            authorProfileUrl(). A link that might land on the wrong person is
            worse than none, so most authors show no button here at all. */}
        {profileUrl && (
          <Button
            nativeButton={false}
            render={
              <a href={profileUrl} target="_blank" rel="noreferrer noopener" />
            }
            variant="outline"
            size="sm"
          >
            <ExternalLink aria-hidden />
            {platformLabel(author.platform)}
          </Button>
        )}
      </section>

      <PostGrid posts={dtos} />
    </div>
  );
}
