import { NextResponse, type NextRequest } from "next/server";
import { requireMember } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * Un-bookmarks a link.
 *
 * Addressed by the bookmark's own id rather than its `memberSeq`, unlike the
 * page at /links/<seq>. The client already holds the id — it comes down in
 * SavedPostDTO — and an opaque id is the right thing for a mutation endpoint:
 * the sequence is a display affordance, and routing a write through it would
 * mean a caller could aim at "my third bookmark" without knowing which row that
 * is. Ownership is still enforced by scoping on memberId either way.
 *
 * Nothing is removed. The row keeps its memos and its `memberSeq`, so saving the
 * link again revives exactly this bookmark — same notes, same URL. That revival
 * is what the soft delete now buys, and it is why the unique on
 * [memberId, postId] could become a real one.
 *
 * **The thumbnail blob is deliberately left alone**, and that is a change from
 * before the split. The image belongs to the shared `Post`, which other members
 * may have bookmarked and which this route must not touch — one member
 * un-bookmarking a link cannot be allowed to break the picture for everyone
 * else. The reference count that used to guard this is gone with the thing it
 * guarded: blobs now have exactly one owning row, written once, never displaced.
 */
export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/posts/[id]">,
) {
  try {
    const member = await requireMember();
    const { id } = await context.params;

    // Scoping by memberId is the ownership check — Prisma connects as the table
    // owner and bypasses row-level security. `deletedAt: null` is one of the
    // read filters the root AGENTS.md lists as moving together: without it,
    // deleting an already-deleted link would stamp a fresh timestamp and answer
    // 204 as though something had happened.
    const found = await prisma.bookmark.findFirst({
      where: { id, memberId: member.id, deletedAt: null },
      select: { id: true },
    });

    if (!found) {
      return NextResponse.json(
        { error: "저장한 링크를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    // Stamped, not removed — see the note above. No transaction: this is a
    // single row update with nothing to keep consistent alongside it now that
    // the blob cleanup is gone.
    await prisma.bookmark.update({
      where: { id: found.id },
      data: { deletedAt: new Date() },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
