import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { savedPostInclude, toSavedPostDTO } from "@/lib/serialize";
import PostsClient from "@/components/PostsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "저장한 게시글 · 찜꽁",
};

export default async function PostsPage() {
  const user = await requireUser();

  const posts = await prisma.savedPost.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: savedPostInclude,
  });

  return <PostsClient initialPosts={posts.map(toSavedPostDTO)} />;
}
