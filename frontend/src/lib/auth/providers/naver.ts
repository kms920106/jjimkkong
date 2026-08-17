import { z } from "zod";
import { AuthProvider } from "@/generated/prisma/enums";
import { OAuthConfigError, type OAuthProviderConfig } from "./types";

/**
 * Naver wraps the profile in a `response` object and reports failures with a
 * 200 plus a non-"00" resultcode, so the HTTP status alone proves nothing.
 *
 * Every field inside `response` except `id` is optional by design: Naver lets
 * the user decline any item on the consent screen, including ones the
 * application marked required. Treating `email` as guaranteed is the classic
 * way this integration breaks in production.
 */
const ProfileSchema = z.object({
  resultcode: z.string(),
  message: z.string().optional(),
  response: z
    .object({
      id: z.string(),
      email: z.string().nullish(),
      name: z.string().nullish(),
      nickname: z.string().nullish(),
      mobile: z.string().nullish(),
    })
    .optional(),
});

export function naverProvider(): OAuthProviderConfig {
  const clientId = process.env.NAVER_LOGIN_CLIENT_ID;
  const clientSecret = process.env.NAVER_LOGIN_CLIENT_SECRET;

  // Deliberately distinct from NAVER_CLIENT_ID / NAVER_CLIENT_SECRET, which
  // belong to the Local Search API used for geocoding. They are different
  // applications with different credentials; reusing one for the other fails
  // with an opaque 401.
  if (!clientId || !clientSecret) {
    throw new OAuthConfigError(
      "NAVER_LOGIN_CLIENT_ID / NAVER_LOGIN_CLIENT_SECRET가 설정되지 않았습니다.",
    );
  }

  return {
    id: AuthProvider.NAVER,
    label: "네이버",
    authorizeUrl: "https://nid.naver.com/oauth2.0/authorize",
    tokenUrl: "https://nid.naver.com/oauth2.0/token",
    profileUrl: "https://openapi.naver.com/v1/nid/me",
    clientId,
    clientSecret,
    // Naver takes the consent items from the application's console registration
    // rather than from a scope parameter, so there is nothing to send.
    scope: null,
    parseProfile(raw) {
      const parsed = ProfileSchema.parse(raw);
      if (parsed.resultcode !== "00" || !parsed.response) {
        throw new OAuthConfigError(
          `네이버 프로필 조회에 실패했습니다. (${parsed.message ?? parsed.resultcode})`,
        );
      }
      const { id, email, name, nickname, mobile } = parsed.response;
      return {
        providerUserId: id,
        email: email ?? null,
        // Naver's `mobile` is the carrier-verified number on the NID account
        // rather than a free-text profile field, but it still only prefills our
        // own SMS challenge. It is a number the account holder registered at
        // some point, which is not the same as proof that whoever is completing
        // this login can receive messages on it today.
        phone: mobile ?? null,
        name: name ?? nickname ?? null,
      };
    },
  };
}
