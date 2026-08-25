import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { toAuthorDTO } from "@/lib/serialize";
import type { PlaceSourceDTO } from "@/lib/types";

/**
 * Every post that names this place. Not scoped to the caller: Place rows are
 * already shared globally (matched on [name, address]), so the map pin itself is
 * communal and this makes the sheet under it communal too. Read-only — writes
 * still go through POST /api/posts and DELETE /api/posts/[id], both scoped to
 * requireMember()'s memberId. No auth gate here for the same reason pages render
 * signed out: this only reads what a signed-in visitor would already see on the
 * shared map.
 *
 * **This query got simpler and safer with the post/bookmark split, and the
 * reason is worth keeping.** It used to read the per-member join table, which
 * meant it returned one row per *member* who had saved the link and needed a
 * relation filter (`post: { deletedAt: null }`) to keep a member's deleted links
 * from being listed to strangers — a privacy bug if omitted, and easy to omit
 * because the column was on another table. Now it reads PostPlace, which hangs
 * off the shared Post and has no member and no `deletedAt` at all: one row per
 * post, nothing per-member to leak.
 *
 * That also means a place keeps its sources after every member un-bookmarks it.
 * Correct, and the point: the pin is communal, so the sheet says which posts
 * name this place — not which members currently keep it.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/places/[id]/sources">,
) {
  try {
    const { id } = await context.params;

    // Parsed rather than passed through: the segment is free text, and a
    // non-numeric value has to answer empty instead of reaching Prisma as a
    // malformed Int, which throws and surfaces as a 500. `Number.parseInt`
    // would accept "1abc" and answer for place 1; this does not.
    //
    // An unknown id is not an error here — this route answers "which posts name
    // this place", and "none" is a valid answer for a place that does not
    // exist. It is unauthenticated, so it must not distinguish a missing place
    // from an empty one.
    const placeId = Number(id);
    if (!Number.isInteger(placeId) || placeId < 1) {
      return NextResponse.json({ sources: [] as PlaceSourceDTO[] });
    }

    const links = await prisma.postPlace.findMany({
      where: { placeId },
      select: {
        post: {
          select: {
            id: true,
            sourceUrl: true,
            platform: true,
            title: true,
            thumbnail: true,
            author: true,
          },
        },
      },
    });

    // Deduped by sourceUrl even though Post.sourceUrl is unique and PostPlace is
    // keyed on [postId, placeId], so this cannot currently produce a repeat. Kept
    // because the *identity* being presented is the link, not the row: if two
    // canonical forms of one post ever coexist, the sheet must still list it
    // once.
    const bySourceUrl = new Map<string, PlaceSourceDTO>();
    for (const { post } of links) {
      if (bySourceUrl.has(post.sourceUrl)) continue;
      bySourceUrl.set(post.sourceUrl, {
        postId: post.id,
        sourceUrl: post.sourceUrl,
        platform: post.platform,
        title: post.title,
        thumbnail: post.thumbnail,
        author: toAuthorDTO(post.author),
      });
    }

    return NextResponse.json({ sources: [...bySourceUrl.values()] });
  } catch (error) {
    return toErrorResponse(error);
  }
}
