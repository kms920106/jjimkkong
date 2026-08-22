import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { deleteThumbnailBlob, isOwnThumbnailBlob } from "@/lib/post-thumbnail";

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/posts/[id]">,
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    // Scoping by userId is the ownership check — Prisma connects as the table
    // owner and bypasses row-level security. Done as a findFirst + update in
    // one transaction rather than updateMany because the row's thumbnail is
    // needed to clean up its blob, and updateMany returns a count.
    const deleted = await prisma.$transaction(async (tx) => {
      const row = await tx.savedPost.findFirst({
        where: { id, userId: user.id, deletedAt: null },
        select: { id: true, thumbnail: true },
      });
      if (!row) return null;

      // Stamped, not deleted. The hard delete this replaces took the post's
      // SavedPostPlace rows with it through the cascade — the memos written on
      // each place and the position that makes /links number them as a route.
      // Those rows are deliberately left in place: sweeping them would undo the
      // recoverability this change exists for.
      await tx.savedPost.update({
        where: { id: row.id },
        data: { deletedAt: new Date() },
      });

      // Whether any *other* row still renders this blob.
      //
      // `id: { not: row.id }` is load-bearing and is new with the soft delete.
      // The hard delete ran this count afterwards, when the row was already
      // gone; now it survives and would count itself, so the total could never
      // reach zero and the blob would never be collected.
      //
      // No `deletedAt` filter here, deliberately. A soft-deleted row still
      // points at its thumbnail and still has to render if it is ever restored,
      // so it counts as a reference. Filtering it out would delete a blob that
      // a soft-deleted row — possibly another user's — still needs.
      //
      // Not bookkeeping — it is the ownership check for the blob. `thumbnail`
      // arrives in a request body on save, and blob URLs are public (they go
      // out in SavedPostDTO, and GET /api/places/[id]/sources serves every
      // user's posts unauthenticated). So a caller can point their own post at
      // someone else's thumbnail and delete the post to take that image down.
      // The URL shape alone cannot tell the two cases apart; a reference count
      // can.
      const stillReferenced = isOwnThumbnailBlob(row.thumbnail)
        ? await tx.savedPost.count({
            where: { thumbnail: row.thumbnail, id: { not: row.id } },
          })
        : 1;

      return { ...row, orphaned: stillReferenced === 0 };
    });

    if (!deleted) {
      return NextResponse.json(
        { error: "저장한 링크를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    // After the commit, and only once nothing references the blob any more.
    // Best effort — a leaked blob costs storage, a throw would fail a delete
    // that already succeeded.
    if (deleted.orphaned) {
      await deleteThumbnailBlob(deleted.thumbnail);
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
