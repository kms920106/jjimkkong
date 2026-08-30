import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { createList, listsForMember } from "@/lib/place-list";
import { isListColor } from "@/lib/place-list/palette";
import { ListVisibility } from "@/generated/prisma/enums";

/**
 * The member's favourite lists.
 *
 * Owned data, so both verbs go through requireMember() and scope by the id it
 * returns — Prisma connects as the table owner and bypasses row-level security,
 * so this is the only place the ownership boundary exists.
 */
export async function GET() {
  try {
    const member = await requireMember();
    return NextResponse.json({ lists: await listsForMember(member.id) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * `color` is checked against the palette allowlist rather than a hex pattern.
 * The value is rendered into an inline `background-color`, so a permissive
 * `/^#[0-9a-f]{6}$/` would still be a string the client chose reaching a style
 * attribute; an allowlist makes the render site safe by construction.
 *
 * `linkUrl` is restricted to http(s). It is rendered as an anchor and never
 * fetched by this server, so the risk is not SSRF but `javascript:` — a scheme
 * that turns the owner's own list page into a script the *viewer* runs, which
 * matters precisely because these lists can be shared.
 */
const createSchema = z.object({
  name: z.string().trim().min(1, "리스트 이름을 입력해 주세요.").max(20),
  color: z.string().refine(isListColor, "색상을 선택해 주세요."),
  description: z.string().trim().max(30).nullish(),
  linkUrl: z
    .union([z.url().refine((v) => /^https?:\/\//i.test(v)), z.literal("")])
    .nullish(),
  visibility: z.enum(ListVisibility).default(ListVisibility.PRIVATE),
});

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const body = createSchema.parse(await request.json());

    const list = await createList(member.id, {
      name: body.name,
      color: body.color,
      // Empty submissions normalise to null so "absent" has one representation,
      // matching how the profile fields are stored.
      description: body.description?.trim() || null,
      linkUrl: body.linkUrl || null,
      visibility: body.visibility,
    });

    return NextResponse.json({ seq: list.memberSeq }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
