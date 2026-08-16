import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { savedPostInclude, toSavedPostDTO } from "@/lib/serialize";
import HomeClient from "@/components/HomeClient";

// Reads the session cookie, so this page is always rendered per request.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();

  const posts = await prisma.savedPost.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: savedPostInclude,
  });

  return (
    // HomeClient reads ?place= via useSearchParams, which Next requires to sit
    // under a Suspense boundary.
    <Suspense>
      <HomeClient
        initialPosts={posts.map(toSavedPostDTO)}
        profile={{
          nickname: user.nickname,
          email: user.email,
          mapProvider: user.mapProvider,
        }}
      />
    </Suspense>
  );
}
