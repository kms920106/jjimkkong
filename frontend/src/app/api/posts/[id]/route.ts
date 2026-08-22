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
    // owner and bypasses row-level security. Done as a findFirst + delete in
    // one transaction rather than deleteMany because the deleted row's
    // thumbnail is needed to clean up its blob, and deleteMany returns a count.
    const deleted = await prisma.$transaction(async (tx) => {
      const row = await tx.savedPost.findFirst({
        where: { id, userId: user.id },
        select: { id: true, thumbnail: true },
      });
      if (!row) return null;

      await tx.savedPost.delete({ where: { id: row.id } });

      // Whether any surviving row still renders this blob. Checked after the
      // delete, so the row being removed is already out of the count.
      //
      // Not bookkeeping — it is the ownership check for the blob. `thumbnail`
      // arrives in a request body on save, and blob URLs are public (they go
      // out in SavedPostDTO, and GET /api/places/[id]/sources serves every
      // user's posts unauthenticated). So a caller can point their own post at
      // someone else's thumbnail and delete the post to take that image down.
      // The URL shape alone cannot tell the two cases apart; a reference count
      // can.
      const stillReferenced = isOwnThumbnailBlob(row.thumbnail)
        ? await tx.savedPost.count({ where: { thumbnail: row.thumbnail } })
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
