import { notFound } from "next/navigation";
import { getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MapProvider } from "@/generated/prisma/enums";
import { savedPostInclude, toSavedPostDTO } from "@/lib/serialize";
import PostDetailClient from "@/components/PostDetailClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "링크 · 찜꽁",
};

/**
 * One saved post, opened from the /links grid.
 *
 * Unlike the pages listed in (app)/AGENTS.md this one *does* 404 for a signed
 * out visitor, and that is not an exception to "pages open without a login" —
 * there is simply no row to render. The post is scoped to its owner, so a
 * caller without a session has no `userId` to query by, exactly as the home
 * map has no pins. What it must never do is redirect to a login.
 *
 * `deletedAt: null` is one of the read filters the root AGENTS.md lists as
 * moving together — without it a deleted link stays readable at its own URL.
 */
export default async function PostDetailPage({
  params,
}: PageProps<"/links/[id]">) {
  const { id } = await params;
  const user = await getUser();
  if (!user) notFound();

  const post = await prisma.savedPost.findFirst({
    where: { id, userId: user.id, deletedAt: null },
    include: savedPostInclude,
  });
  if (!post) notFound();

  return (
    <PostDetailClient
      post={toSavedPostDTO(post)}
      // Not on SavedPostDTO: only this page renders it, and putting it in the
      // shared DTO would ship every caption to the grid, which shows none.
      caption={post.caption}
      mapProvider={user.mapProvider ?? MapProvider.NAVER}
    />
  );
}
