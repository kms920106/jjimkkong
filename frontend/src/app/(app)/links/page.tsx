import { getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MapProvider } from "@/generated/prisma/enums";
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
        where: { userId: user.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: savedPostInclude,
      })
    : [];

  return (
    <LinksClient
      initialPosts={posts.map(toSavedPostDTO)}
      // Picks which external map app a place row offers first. Signed out
      // there is no stored preference, so it matches the default a new
      // account starts on — the same fallback the home map uses.
      mapProvider={user?.mapProvider ?? MapProvider.NAVER}
      signedIn={user !== null}
    />
  );
}
