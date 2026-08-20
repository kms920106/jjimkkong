import type { NextRequest } from "next/server";
import { handleChallengeVerify } from "@/lib/auth/phone-challenge-flow";

/**
 * Step 2 of resetting a password: redeem the code.
 *
 * Issues no session — the existing session, if any, is deliberately left alone
 * until the new password is actually set in step 3.
 */
export async function POST(request: NextRequest) {
  return handleChallengeVerify(request, "reset");
}
