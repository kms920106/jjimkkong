import { NextResponse } from "next/server";
import {
  DEV_SESSION_COOKIE,
  DEV_USER_ID,
  devLoginEnabled,
} from "@/lib/dev-auth";

/**
 * Issues the local test session. Returns 404 unless DEV_TEST_LOGIN=1 in a
 * non-production build, so the endpoint does not exist in a deployment.
 */
export async function POST() {
  if (!devLoginEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DEV_SESSION_COOKIE, DEV_USER_ID, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
