import { getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { savedPostInclude, toSavedPostDTO } from "@/lib/serialize";
import LinksClient from "@/components/LinksClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "링크 · 찜꽁",
};

export default async function PostsPage() {
  // Public, like the map: signed out this is an empty list that offers a login
  // rather than a redirect.
  const user = await getUser();

  const posts = user
    ? await prisma.savedPost.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: savedPostInclude,
      })
    : [];

  return (
    <LinksClient
      initialPosts={posts.map(toSavedPostDTO)}
      signedIn={user !== null}
    />
  );
}
