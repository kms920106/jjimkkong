import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  deleteProfileImage,
  MAX_UPLOAD_BYTES,
  ProfileImageError,
  putProfileImage,
} from "@/lib/profile-image";

/**
 * The 6MB body plus a round trip to Blob storage does not fit the default
 * function timeout on a slow mobile uplink, and a platform timeout surfaces as
 * an opaque 504 — no Korean message for the user, nothing in the log for us.
 */
export const maxDuration = 60;

/**
 * Separate from PATCH /api/settings because this one is multipart: the picture
 * arrives as a File, and a JSON body cannot carry it without base64 inflating
 * every upload by a third. The text fields ride along in the same request so
 * the 완료 button is one round trip and cannot half-apply.
 *
 * Both text fields are always present — the form submits its whole state — so
 * unlike /api/settings there is no "omitted means untouched" rule here.
 */
/**
 * Rejects C0/C1 controls and every format character, which is what U+202E
 * (right-to-left override) is.
 *
 * Length alone does not keep these two fields from wrecking the drawer: the
 * name row and the status line render right above the email and masked phone,
 * and a bidi override inside the status message visually scrambles the lines
 * beneath it. `truncate` bounds width, not direction.
 */
const SAFE_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;
const MESSAGE = "사용할 수 없는 문자가 포함되어 있습니다.";

const FieldsSchema = z.object({
  nickname: z.string().trim().max(20).regex(SAFE_TEXT, MESSAGE),
  statusMessage: z.string().trim().max(60).regex(SAFE_TEXT, MESSAGE),
});

export async function PATCH(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireMember();

    // Sheds an obviously oversized upload before formData() buffers the whole
    // body into memory. Content-Length is caller-supplied and therefore not a
    // real limit — the check inside putProfileImage() is the gate; this only
    // avoids paying for the honest-but-huge case. The slack covers the
    // multipart envelope around the file itself. A proper ceiling needs an edge
    // body-size rule, which this app does not have yet.
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
      throw new ProfileImageError("이미지 크기는 6MB까지만 올릴 수 있습니다.");
    }

    const form = await request.formData();
    const fields = FieldsSchema.parse({
      nickname: form.get("nickname") ?? "",
      statusMessage: form.get("statusMessage") ?? "",
    });

    // Three states, not two: a File means replace, the literal "1" on
    // removeImage means clear, and neither means leave the current picture
    // alone. A plain "is the file missing" check would silently delete the
    // picture every time the user only edited their nickname.
    const upload = form.get("image");
    const removeImage = form.get("removeImage") === "1";

    let imageUrl: string | null | undefined;
    if (upload instanceof File) {
      imageUrl = await putProfileImage(user.id, upload);
    } else if (removeImage) {
      imageUrl = null;
    }

    // The previous URL is re-read inside the transaction rather than taken from
    // the `user` row requireMember() returned, which was fetched before the
    // upload. Two saves racing (a double-tap, two tabs) both read the same
    // stale value there, so both would delete that one blob and neither would
    // delete the one the other superseded — leaking a billable object with
    // nothing referencing it.
    const { previous, updated } = await prisma.$transaction(async (tx) => {
      const before = await tx.member.findUniqueOrThrow({
        where: { id: user.id },
        select: { imageUrl: true },
      });
      const row = await tx.member.update({
        where: { id: user.id },
        data: {
          // Empty clears back to null so the display falls through to the email
          // local part, which is what an account that never set a nickname shows.
          nickname: fields.nickname === "" ? null : fields.nickname,
          statusMessage:
            fields.statusMessage === "" ? null : fields.statusMessage,
          ...(imageUrl !== undefined && { imageUrl }),
        },
      });
      return { previous: before.imageUrl, updated: row };
    });

    // After the row is committed, and only for a picture that is now
    // unreferenced. Deleting first would leave the profile pointing at a blob
    // that no longer exists if the update then failed.
    if (imageUrl !== undefined && previous !== updated.imageUrl) {
      await deleteProfileImage(previous);
    }

    return NextResponse.json({
      nickname: updated.nickname,
      statusMessage: updated.statusMessage,
      imageUrl: updated.imageUrl,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
