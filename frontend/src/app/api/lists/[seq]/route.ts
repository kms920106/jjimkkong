import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { deleteList, updateList } from "@/lib/place-list";
import { isListColor } from "@/lib/place-list/palette";
import { ListVisibility } from "@/generated/prisma/enums";

/**
 * The same allowlist and scheme restrictions POST /api/lists applies, for the
 * same reasons — see the note there. Every field optional: this is a PATCH, and
 * the edit sheet submits only what changed.
 */
const patchSchema = z.object({
  name: z.string().trim().min(1).max(20).optional(),
  color: z.string().refine(isListColor, "색상을 선택해 주세요.").optional(),
  description: z.string().trim().max(30).nullish(),
  linkUrl: z
    .union([z.url().refine((v) => /^https?:\/\//i.test(v)), z.literal("")])
    .nullish(),
  visibility: z.enum(ListVisibility).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/lists/[seq]">,
) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const seq = parseSeq((await context.params).seq);
    const body = patchSchema.parse(await request.json());

    // `undefined` means "not submitted" and must not become a write, while an
    // explicit null clears the field. Spreading only the keys that are present
    // is what keeps those two apart — `description: undefined` in a Prisma
    // `data` is ignored, but building the object by hand makes that intent
    // legible rather than incidental.
    await updateList(member.id, seq, {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.description !== undefined && {
        description: body.description?.trim() || null,
      }),
      ...(body.linkUrl !== undefined && { linkUrl: body.linkUrl || null }),
      ...(body.visibility !== undefined && { visibility: body.visibility }),
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Throws the list away. A state change, not a delete — the entries and the
 * notes on them stay, exactly as a deleted Bookmark keeps its memos.
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/lists/[seq]">,
) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    await deleteList(member.id, parseSeq((await context.params).seq));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * The path segment is free text. Parsed with `Number` rather than `parseInt`
 * because the latter accepts "1abc" and would answer for list 1 — the same
 * check GET /api/places/[id]/sources makes. A non-numeric segment becomes a
 * ZodError, i.e. a 400, rather than reaching Prisma as a malformed Int and
 * surfacing as a 500.
 */
function parseSeq(raw: string): number {
  return z.number().int().positive().parse(Number(raw));
}
