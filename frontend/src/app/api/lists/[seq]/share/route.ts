import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { requireSameOrigin, toErrorResponse } from "@/lib/api";
import { ensureShareToken } from "@/lib/place-list";

/**
 * Mints (or returns) the list's share token and answers with the URL to hand
 * out.
 *
 * **A POST rather than the page computing the URL, because pressing 공유 is the
 * act that makes a 일부 공개 list reachable.** Until this route runs, the list has
 * no token and therefore no address — which is how "shared it" and "can be
 * opened" stay the same fact instead of two that drift apart.
 *
 * Idempotent: a list that already has a token gets the same one back, so the
 * link an owner sent last month keeps working when they press 공유 again.
 *
 * The origin is built here rather than in the browser so the owner is handed a
 * link that works from outside their own tab — and `AUTH_BASE_URL` wins when
 * set, for the deployments where the Host header is the internal one.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/lists/[seq]/share">,
) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const seq = z
      .number()
      .int()
      .positive()
      .parse(Number((await context.params).seq));

    const token = await ensureShareToken(member.id, seq);

    // Unlike lib/auth/urls.ts's baseUrl(), a missing AUTH_BASE_URL falls back
    // to the request origin even in production instead of throwing. The
    // asymmetry is deliberate: a redirect_uri built from an attacker-influenced
    // Host is sent to an OAuth provider and can hijack a real login, whereas
    // this string is only ever shown back to the member who asked to share
    // their own list. The worst a forged Host does is hand that one member a
    // link that does not work.
    const configured = process.env.AUTH_BASE_URL?.replace(/\/$/, "");
    const origin = configured ?? new URL(request.url).origin;

    return NextResponse.json({ url: `${origin}/s/${token}` });
  } catch (error) {
    return toErrorResponse(error);
  }
}
