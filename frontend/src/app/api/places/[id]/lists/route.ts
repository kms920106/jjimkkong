import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMember, requireMember } from "@/lib/auth";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import {
  listSeqsContaining,
  listsForMember,
  removePlaceEverywhere,
} from "@/lib/place-list";
import type { PlaceListPickerDTO } from "@/lib/types";

/**
 * What the place sheet's star needs: the caller's lists, and which of them hold
 * this place.
 *
 * Both halves in one response because the sheet needs them together — a star
 * that fills a beat after the sheet opens reads as a mis-tap, and the picker
 * that opens from it must already know what to pre-check.
 *
 * Unlike its sibling `/sources`, this **is** scoped to the caller: the sources
 * of a pin are communal (the place row is shared), but which lists someone
 * keeps it in is theirs alone. Signed out it answers an empty picker rather
 * than 401, matching how every page in this app renders signed out — the star
 * is then an affordance that opens the login drawer, not a broken control.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/places/[id]/lists">,
) {
  try {
    const member = await getMember();
    const empty: PlaceListPickerDTO = { lists: [], containing: [] };
    if (!member) return NextResponse.json(empty);

    const placeId = Number((await context.params).id);
    if (!Number.isInteger(placeId) || placeId < 1) {
      return NextResponse.json(empty);
    }

    // Two queries rather than one join: the picker needs every list the member
    // has, including the ones that do not hold this place, so the "containing"
    // set cannot fall out of the same read.
    const [lists, containing] = await Promise.all([
      listsForMember(member.id),
      listSeqsContaining(member.id, placeId),
    ]);

    return NextResponse.json({ lists, containing } satisfies PlaceListPickerDTO);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Un-favourites the place from every one of the caller's lists — what tapping a
 * filled star does.
 *
 * A single route rather than the client looping over `/lists/<seq>/places/<id>`
 * so a place in four lists cannot end up half-removed when the tab is closed
 * midway. Requires a session, unlike the GET above: this one writes.
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/places/[id]/lists">,
) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const placeId = z
      .number()
      .int()
      .positive()
      .parse(Number((await context.params).id));

    await removePlaceEverywhere(member.id, placeId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
