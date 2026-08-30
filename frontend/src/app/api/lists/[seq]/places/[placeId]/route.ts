import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { removePlaceFromList } from "@/lib/place-list";

/**
 * Un-favourites a place from one list.
 *
 * Marks the entry removed rather than deleting the row — it carries the
 * member's memo, so re-adding the place brings the note back. See
 * `PlaceListEntry.removedAt` in schema.prisma; the runtime guard refuses a
 * hard delete here for exactly that reason.
 *
 * 204 whether or not anything matched. The scoping happens inside the
 * `updateMany`, so a list belonging to someone else simply matches zero rows —
 * and answering 404 for that case would turn this route into a probe for which
 * list numbers other members hold.
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/lists/[seq]/places/[placeId]">,
) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const params = await context.params;
    const seq = z.number().int().positive().parse(Number(params.seq));
    const placeId = z.number().int().positive().parse(Number(params.placeId));

    await removePlaceFromList(member.id, seq, placeId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
