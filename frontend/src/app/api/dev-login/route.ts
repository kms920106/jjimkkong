import { NextResponse } from "next/server";
import { DEV_SESSION_COOKIE, DEV_USER_ID } from "@/lib/dev-auth";

/** Issues the local test session. See dev-auth.ts for why this is unconditional. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(DEV_SESSION_COOKIE, DEV_USER_ID, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
