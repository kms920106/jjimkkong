import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { MapProvider } from "@/generated/prisma/enums";

const BodySchema = z.object({
  mapProvider: z.enum(MapProvider),
});

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const { mapProvider } = BodySchema.parse(await request.json());

    const updated = await prisma.userProfile.update({
      where: { id: user.id },
      data: { mapProvider },
    });

    return NextResponse.json({ mapProvider: updated.mapProvider });
  } catch (error) {
    return toErrorResponse(error);
  }
}
