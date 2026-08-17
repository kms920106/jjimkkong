-- Withdrawal becomes a status change instead of a delete: the UserProfile row,
-- its AuthIdentity rows, and every SavedPost underneath are all kept.
--
-- That breaks two uniqueness assumptions, because a withdrawn row goes on
-- holding the phone number and the provider id it was created with:
--
--   * UserProfile.phone was globally unique, so the same person could never
--     sign up again with their own number.
--   * AuthIdentity[provider, providerUserId] was globally unique, so a
--     returning Naver user would match their old identity row and be handed
--     the withdrawn profile back.
--
-- Both are replaced by partial unique indexes scoped to live rows. Postgres
-- supports these; Prisma's schema language cannot express them, which is why
-- they live here and the schema carries plain @@index declarations instead.

ALTER TABLE "UserProfile" ADD COLUMN "withdrawnAt" TIMESTAMP(3);
ALTER TABLE "AuthIdentity" ADD COLUMN "withdrawnAt" TIMESTAMP(3);

-- Phone: many withdrawn rows may share a number, at most one live row may hold
-- it. NULL phones are exempt either way — Postgres treats NULLs as distinct in
-- unique indexes, which is what lets a pending-SMS account exist without one.
DROP INDEX "UserProfile_phone_key";
CREATE UNIQUE INDEX "UserProfile_phone_live_key"
  ON "UserProfile"("phone")
  WHERE "withdrawnAt" IS NULL;
-- Kept as a plain index so support lookups by number still hit an index after
-- the unique one stopped covering withdrawn rows.
CREATE INDEX "UserProfile_phone_idx" ON "UserProfile"("phone");

-- Provider identity: same shape. The lookup in linkProviderIdentity() filters
-- on withdrawnAt IS NULL, and this index is what makes that both correct and
-- indexed.
DROP INDEX "AuthIdentity_provider_providerUserId_key";
CREATE UNIQUE INDEX "AuthIdentity_provider_providerUserId_live_key"
  ON "AuthIdentity"("provider", "providerUserId")
  WHERE "withdrawnAt" IS NULL;
CREATE INDEX "AuthIdentity_provider_providerUserId_idx"
  ON "AuthIdentity"("provider", "providerUserId");

-- Partial index on the withdrawal predicate itself: every session resolve and
-- every merge lookup filters on it, and it is highly selective (almost all rows
-- are live).
CREATE INDEX "UserProfile_withdrawnAt_idx" ON "UserProfile"("withdrawnAt")
  WHERE "withdrawnAt" IS NOT NULL;
