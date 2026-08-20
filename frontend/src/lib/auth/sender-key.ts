import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * An opaque per-caller key derived from the request's network address, for the
 * SMS send budget in sms.ts.
 *
 * Hashed rather than stored raw. An IP is personal data, the table it lands in
 * deliberately holds a blind index of the phone number instead of the number, and
 * nothing ever needs to read an address back out — the budget is an equality
 * count. Keyed with AUTH_SECRET so a table dump does not let addresses be
 * confirmed by guessing, which for IPv4 is a 2^32 sweep.
 */
export function senderKeyOf(request: NextRequest): string | null {
  const address = clientAddress(request);
  if (!address) return null;
  return createHmac("sha256", secret()).update(`sender:${address}`).digest("base64url");
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "AUTH_SECRET이 설정되지 않았거나 너무 짧습니다. (32자 이상 필요)",
    );
  }
  return value;
}

/**
 * The caller's address as this deployment can best determine it.
 *
 * Takes the *leftmost* `x-forwarded-for` entry, which is the client-supplied end
 * of the chain and therefore the spoofable one. That is a deliberate trade, not
 * an oversight: the alternative is the rightmost entry, which on Vercel is the
 * proxy's own address and would collapse every visitor onto one key, turning a
 * per-caller budget into a global one that the first abuser exhausts for
 * everybody. Leftmost is what actually distinguishes callers.
 *
 * So an attacker who rotates this header rotates their key and escapes the
 * budget. This limit is the outermost of four, and the three inner ones
 * (per-number cooldown, per-number hourly, per-attempt) still hold against them
 * — it raises the cost of fan-out from "a loop" to "a loop that also forges a
 * header", and it is not the last line of defence. Closing it properly means an
 * edge rate rule, where the platform sees the real connection.
 *
 * Returns null when no header is present, which is the local-dev case. Callers
 * skip the budget rather than reject, so `next dev` is not a login-less
 * environment.
 */
function clientAddress(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    // Length-capped before it becomes an HMAC input: the header is attacker
    // controlled and unbounded, and there is no address longer than an IPv6
    // literal with a zone id.
    if (first && first.length > 0) return first.slice(0, 64);
  }
  // Vercel sets this; it is not client-supplied, but it is absent locally.
  const real = request.headers.get("x-real-ip");
  return real ? real.slice(0, 64) : null;
}
