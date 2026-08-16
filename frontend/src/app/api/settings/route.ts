import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { MapProvider } from "@/generated/prisma/enums";

/**
 * Both fields are optional so the drawer can save a nickname without
 * restating the map provider (and vice versa). An omitted key is left
 * untouched; an empty nickname clears it back to the email fallback.
 */
const BodySchema = z
  .object({
    mapProvider: z.enum(MapProvider).optional(),
    nickname: z.string().trim().max(20).optional(),
  })
  .refine(
    (body) => body.mapProvider !== undefined || body.nickname !== undefined,
    { message: "변경할 항목이 없습니다." },
  );

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = BodySchema.parse(await request.json());

    const updated = await prisma.userProfile.update({
      where: { id: user.id },
      data: {
        ...(body.mapProvider !== undefined && {
          mapProvider: body.mapProvider,
        }),
        ...(body.nickname !== undefined && {
          nickname: body.nickname === "" ? null : body.nickname,
        }),
      },
    });

    return NextResponse.json({
      mapProvider: updated.mapProvider,
      nickname: updated.nickname,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
