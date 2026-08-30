import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { addPlaceToList, requireOwnedList } from "@/lib/place-list";
import { prisma } from "@/lib/prisma";

const addSchema = z.object({
  placeId: z.number().int().positive(),
  memo: z.string().trim().max(200).nullish(),
});

/**
 * Adds a place to one of the caller's lists.
 *
 * The place is named by id rather than by name/coordinates, and that is the
 * whole reason this route is safe to keep short: it can only ever point at a
 * `Place` row that already exists, so there is no path here for a client to
 * mint a place or move a pin. This repository's "never trust client
 * coordinates" rule is satisfied by construction rather than by re-geocoding —
 * nothing about the shared row is written.
 *
 * The id is still checked for existence, because a missing one would otherwise
 * fail as a foreign-key violation and surface as an opaque 500.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/lists/[seq]/places">,
) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const seq = z.number().int().positive().parse(Number((await context.params).seq));
    const body = addSchema.parse(await request.json());

    // Ownership first: this throws ListNotFoundError for a list that is not the
    // caller's, so a probe cannot learn whether a place id exists by watching
    // which error comes back.
    const list = await requireOwnedList(member.id, seq);

    const place = await prisma.place.findUnique({
      where: { id: body.placeId },
      select: { id: true },
    });
    if (!place) {
      return NextResponse.json(
        { error: "장소를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    await addPlaceToList(list.id, place.id, body.memo?.trim() || null);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
