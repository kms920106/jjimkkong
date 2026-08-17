-- Removes the local test login. The DEV provider was an unauthenticated bypass:
-- anyone could POST /api/dev-login and become a fixed uuid. The route, lib, and
-- seed are gone, so the enum value has no writer left.

-- The identity rows go first, or the type swap below fails on values it cannot
-- cast. Their UserProfile is left alone on purpose: it may own SavedPost rows,
-- and dropping the profile would cascade them away. Without an identity it is
-- simply unreachable, which is the point.
DELETE FROM "AuthIdentity" WHERE "provider" = 'DEV';

-- Postgres cannot drop a value from an enum, so the type is rebuilt. Casting
-- through text is what lets the column move between the two types.
--
-- The indexes on "provider" survive this untouched: ALTER COLUMN ... TYPE
-- reparses each dependent index's original expression against the new type and
-- rebuilds it. That includes AuthIdentity_provider_providerUserId_live_key, the
-- partial unique index (WHERE "withdrawnAt" IS NULL) that carries the account
-- merge invariant — so this does not need to be dropped and recreated by hand.
ALTER TYPE "AuthProvider" RENAME TO "AuthProvider_old";
CREATE TYPE "AuthProvider" AS ENUM ('NAVER', 'KAKAO', 'APPLE', 'GOOGLE');
ALTER TABLE "AuthIdentity"
  ALTER COLUMN "provider" TYPE "AuthProvider"
  USING ("provider"::text::"AuthProvider");
DROP TYPE "AuthProvider_old";
