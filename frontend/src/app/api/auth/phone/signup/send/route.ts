import type { NextRequest } from "next/server";
import { handleChallengeSend } from "@/lib/auth/phone-challenge-flow";

/**
 * Step 1 of signing up with a phone number: send the verification code.
 *
 * Unauthenticated by necessity — this is the entry point for a brand-new account,
 * so there is no prior credential to gate on. What bounds it is the per-caller and
 * per-number budgeting in sms.ts; see handleChallengeSend.
 */
export async function POST(request: NextRequest) {
  return handleChallengeSend(request, "signup");
}
