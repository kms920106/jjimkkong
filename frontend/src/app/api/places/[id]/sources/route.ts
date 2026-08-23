import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { PlaceSourceDTO } from "@/lib/types";

/**
 * Every saved post that names this place, across every user — not just the
 * caller's own. Place rows are already shared globally (matched on
 * [name, address]), so the map pin itself is already communal; this makes the
 * sheet under it communal too. Read-only: deleting or editing a post still
 * goes through POST /api/posts and DELETE /api/posts/[id], both of which stay
 * scoped to requireUser()'s userId. No auth gate here for the same reason
 * pages render signed out — this only reads what a signed-in visitor could
 * already see on the shared map.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/places/[id]/sources">,
) {
  try {
    const { id } = await context.params;

    // The relation filter is not optional. This query reads SavedPostPlace, and
    // a soft-deleted post keeps its place links, so without `post.deletedAt` a
    // link the user deleted would go on being listed here — and this route
    // serves every user's posts without authentication, so it would be listed
    // to strangers. Nothing else in this file would look wrong.
    const links = await prisma.savedPostPlace.findMany({
      where: { placeId: id, post: { deletedAt: null } },
      select: {
        memo: true,
        post: {
          select: {
            id: true,
            sourceUrl: true,
            platform: true,
            title: true,
            thumbnail: true,
            author: true,
            authorImage: true,
          },
        },
      },
    });

    // The same post (same sourceUrl) can only be saved once per user
    // (@@unique([userId, sourceUrl])), but two different users saving the
    // same link produces two SavedPost rows here — one per user — so the
    // dedupe has to happen by sourceUrl, not by postId.
    const bySourceUrl = new Map<string, PlaceSourceDTO>();
    for (const link of links) {
      if (bySourceUrl.has(link.post.sourceUrl)) continue;
      bySourceUrl.set(link.post.sourceUrl, {
        postId: link.post.id,
        sourceUrl: link.post.sourceUrl,
        platform: link.post.platform,
        title: link.post.title,
        thumbnail: link.post.thumbnail,
        author: link.post.author,
        authorImage: link.post.authorImage,
        memo: link.memo,
      });
    }

    return NextResponse.json({ sources: [...bySourceUrl.values()] });
  } catch (error) {
    return toErrorResponse(error);
  }
}
