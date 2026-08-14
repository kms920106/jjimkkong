import { NextResponse } from "next/server";
import { DEV_SESSION_COOKIE, devLoginEnabled } from "@/lib/dev-auth";

/** Clears the local test session. 404s outside dev, like /api/dev-login. */
export async function POST() {
  if (!devLoginEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(DEV_SESSION_COOKIE);
  return response;
}
