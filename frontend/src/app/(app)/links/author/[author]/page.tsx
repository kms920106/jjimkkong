import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Platform } from "@/generated/prisma/enums";
import { savedPostInclude, toSavedPostDTO } from "@/lib/serialize";
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
 * Everything this user has saved from one author.
 *
 * Reached from the author overlay on a post's picture. Like /links/[id] it
 * 404s for a signed out visitor, and for the same reason that is not an
 * exception to "pages open without a login": the listing is scoped to the
 * caller's own saves, so without a session there is no `userId` to query by
 * and therefore nothing to render. What it must never do is redirect to a
 * login.
 *
 * `deletedAt: null` is one of the read filters the root AGENTS.md lists as
 * moving together — without it a deleted link would still be listed here even
 * though it has vanished from the grid it was deleted in.
 */
export default async function AuthorPostsPage({
  params,
  searchParams,
}: PageProps<"/links/author/[author]">) {
  const { author: encoded } = await params;
  const { platform: rawPlatform } = await searchParams;

  // Next has already percent-decoded the segment. An empty handle can only
  // come from a hand-typed URL and matches nothing, so it is a 404 rather than
  // a query that would scan the user's whole table for `author: ""`.
  const author = decodeURIComponent(encoded);
  if (!author) notFound();

  // Validated against the enum rather than cast: this arrives in a query
  // string, so an unknown value must narrow the query to nothing or widen it
  // to every platform — never reach Prisma as an invalid enum member.
  const platform =
    typeof rawPlatform === "string" && rawPlatform in Platform
      ? (rawPlatform as Platform)
      : null;

  const user = await getUser();
  if (!user) notFound();

  const posts = await prisma.savedPost.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      author,
      // Absent when the caller gave no platform: the listing is still correct,
      // just potentially mixing two platforms that happen to share a handle.
      ...(platform ? { platform } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: savedPostInclude,
  });

  // An author with nothing saved is a URL for a person this user never saved
  // from — there is no page to show, so it is a 404 rather than an empty grid
  // that would look like the posts had been deleted.
  if (posts.length === 0) notFound();

  const dtos = posts.map(toSavedPostDTO);

  // From the newest post rather than any post: an author who changed their
  // picture should show the current one, and the newest save is the closest
  // thing this app has to "current".
  const authorImage = dtos.find((post) => post.authorImage)?.authorImage ?? null;
  const profileUrl = platform ? authorProfileUrl(author, platform) : null;

  return (
    <div className="flex w-full flex-col pb-8">
      {/* Back to the grid, not to the post that linked here: the author page is
          a listing, so the listing it belongs beside is the natural parent. The
          browser's own back gesture still returns to the post. */}
      <SettingsHeader href="/links" ariaLabel="링크 목록으로" title="작성자" />

      <section className="flex flex-col items-center gap-3 px-4 py-6">
        <AuthorAvatar
          author={author}
          authorImage={authorImage}
          className="size-20"
        />

        <div className="flex flex-col items-center gap-1">
          <h2 className="text-lg font-medium break-all">{author}</h2>
          <p className="text-xs text-muted-foreground">
            {platform ? `${platformLabel(platform)} · ` : ""}
            저장한 링크 {dtos.length}개
          </p>
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
            {platform ? platformLabel(platform) : "프로필"} 프로필
          </Button>
        )}
      </section>

      <PostGrid posts={dtos} />
    </div>
  );
}
