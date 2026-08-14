import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/posts/[id]">,
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    // Scoping the delete by userId is the ownership check — Prisma connects as
    // the table owner and bypasses row-level security.
    const { count } = await prisma.savedPost.deleteMany({
      where: { id, userId: user.id },
    });

    if (count === 0) {
      return NextResponse.json(
        { error: "저장한 게시글을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
