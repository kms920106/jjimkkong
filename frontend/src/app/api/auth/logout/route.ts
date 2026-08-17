import { NextResponse, type NextRequest } from "next/server";
import {
  clearSessionCookie,
  destroySession,
  SESSION_COOKIE,
} from "@/lib/auth/session";

/**
 * Signs out. Deletes the session row as well as the cookie, so the token is
 * dead even if a copy of it was captured — that revocability is the reason
 * sessions live in the database rather than in a self-contained token.
 */
export async function POST(request: NextRequest) {
  await destroySession(request.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
