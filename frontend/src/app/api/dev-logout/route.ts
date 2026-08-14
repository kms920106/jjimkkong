import { NextResponse } from "next/server";
import { DEV_SESSION_COOKIE } from "@/lib/dev-auth";

/** Clears the local test session. See dev-auth.ts. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(DEV_SESSION_COOKIE);
  return response;
}
