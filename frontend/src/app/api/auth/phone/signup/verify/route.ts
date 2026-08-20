import type { NextRequest } from "next/server";
import { handleChallengeVerify } from "@/lib/auth/phone-challenge-flow";

/**
 * Step 2 of signing up: redeem the code.
 *
 * Issues no session. The account does not exist yet and will not until a password
 * is chosen in step 3 — a session handed out here would be access to an account
 * whose credential is still unset.
 */
export async function POST(request: NextRequest) {
  return handleChallengeVerify(request, "signup");
}
