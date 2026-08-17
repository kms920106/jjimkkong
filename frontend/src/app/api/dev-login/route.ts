import { NextResponse, type NextRequest } from "next/server";
import { toErrorResponse } from "@/lib/api";
import { ensureDevUser } from "@/lib/dev-auth";
import { createSession, setSessionCookie } from "@/lib/auth/session";

/** Issues a real session for the fixed test user. See dev-auth.ts. */
export async function POST(request: NextRequest) {
  try {
    const user = await ensureDevUser();
    const cookie = await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
    });
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, cookie);
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
