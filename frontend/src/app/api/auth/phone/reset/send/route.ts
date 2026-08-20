import type { NextRequest } from "next/server";
import { handleChallengeSend } from "@/lib/auth/phone-challenge-flow";

/**
 * Step 1 of resetting a forgotten password: send the verification code.
 *
 * Answers identically for a number with no account. Reporting "no such account"
 * would make this a membership oracle for any number, and the flow is reachable
 * with no credential at all — so an unknown number receives a real code and a
 * success response, and simply cannot complete step 3.
 */
export async function POST(request: NextRequest) {
  return handleChallengeSend(request, "reset");
}
