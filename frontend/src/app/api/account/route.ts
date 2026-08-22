import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { deleteProfileImage } from "@/lib/profile-image";

/**
 * Withdraws the signed-in account.
 *
 * No stored data is deleted. The UserProfile row, its AuthIdentity rows, and
 * every SavedPost underneath are all kept; only `withdrawnAt` is stamped. The
 * two exceptions are sessions (see below) and the profile picture, which is a
 * public blob URL rather than row data and so has to be removed outright to
 * actually become unreachable. What makes
 * that a real withdrawal rather than a flag nobody reads is that the flag is
 * load-bearing in three places, and all three must stay in agreement:
 *
 *   1. requireUser()/getUser() reject a withdrawn profile, so no request can
 *      act as one even with a live cookie.
 *   2. Sessions are deleted outright, so existing cookies stop resolving
 *      immediately rather than waiting for the check above.
 *   3. linkProviderIdentity() skips withdrawn identities and withdrawn merge
 *      targets, so signing back in with the same Naver account creates a *new*
 *      person instead of resurrecting this one.
 *
 * Ownership is the session itself: requireUser() resolves the cookie to exactly
 * one UserProfile and that is the only row this route can reach, so there is no
 * id in the request body to tamper with.
 */
export async function DELETE(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();

    // No request body is read at all. The confirmation is the dialog in the
    // drawer, so there is nothing for the server to validate — and a body it
    // does not read cannot be a way in. The gate that does matter is
    // requireSameOrigin() plus the session: a caller who can reach this route
    // is already the account holder.

    // Id only: the point of the soft delete is that the row is still there to
    // look up, so there is no reason to copy personal data into the log.
    console.info("Account withdrawn:", { userId: user.id });

    const withdrawnAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.userProfile.update({
        where: { id: user.id },
        // imageUrl is nulled even though withdrawal keeps every other field.
        // It is not row data — it is a public, unauthenticated URL on the blob
        // CDN, so "unreachable through the app" does not make the picture
        // unreachable. A face photo staying fetchable by anyone who ever saw
        // the link is not what withdrawal promises.
        data: { withdrawnAt, imageUrl: null },
      });

      // Stamped on the identity rows too, so the partial unique index can free
      // up [provider, providerUserId] for a future sign-in. Same transaction as
      // the profile — a half-applied withdrawal would either strand the account
      // (profile withdrawn, identity still occupying the provider id) or leak
      // it back (identity freed while the profile still answers as live).
      await tx.authIdentity.updateMany({
        where: { userId: user.id },
        data: { withdrawnAt },
      });

      // Deleted, not flagged. Sessions are the one thing with no reason to
      // survive: keeping them would leave live cookies pointing at a withdrawn
      // account, relying entirely on the requireUser() check to hold. Dropping
      // the rows revokes every browser at once, which is the property the
      // database-backed session design exists for.
      await tx.session.deleteMany({ where: { userId: user.id } });
    });

    // After the transaction, and best effort: the row no longer points at it, so
    // a failed delete leaks a blob but must not fail a withdrawal that already
    // committed. Nothing else can reference this URL — Place rows are shared
    // between users, profile pictures never are.
    await deleteProfileImage(user.imageUrl);

    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
