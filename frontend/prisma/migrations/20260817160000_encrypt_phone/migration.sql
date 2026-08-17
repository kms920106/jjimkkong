-- The phone number becomes two columns: a deterministic blind index that
-- carries the account-merge uniqueness, and an AES-256-GCM ciphertext that
-- decrypts back to `01012345678`. See lib/auth/phone-crypto.ts for why one
-- column cannot do both jobs.
--
-- The stored format also changes from E.164 (`+821012345678`) to bare local
-- digits (`01012345678`), which is what the form takes and what Solapi wants.
-- That matters here for one reason: the local form is the input to the blind
-- index, so converting the format and computing the hash have to happen against
-- the same string. They do, because the backfill below does both at once by
-- feeding the old value through normalizeKoreanMobile() before sealing it.
--
-- SEQUENCING: this is a single migration plus a one-off script, which is safe
-- because no live traffic holds a phone number yet (the only sign-in path in
-- every environment is the dev bypass, which creates its profile with no
-- number). Against real traffic this would have to be split: an old app
-- instance still writing only the dropped column would insert rows with
-- phoneHash NULL, and Postgres treats NULLs as distinct in a unique index, so
-- those rows would slip past the merge-key uniqueness and let one number own
-- two live profiles. The safe shape there is add columns -> deploy dual-write
-- -> backfill -> add unique index -> deploy read-switch -> drop old column.

ALTER TABLE "UserProfile" ADD COLUMN "phoneHash" TEXT;
ALTER TABLE "UserProfile" ADD COLUMN "phoneEnc" TEXT;

-- Neither column can be computed in SQL: both need the app's
-- PHONE_ENCRYPTION_KEY, which deliberately never reaches the database. The old
-- plaintext is left in place for `scripts/backfill-phone-encryption.ts` to read,
-- and dropped by the follow-up migration once that has run.
--
-- Until then a profile whose number has not been sealed yet has phoneHash NULL,
-- which reads as "no number" — the same state as an account mid-SMS-challenge.
-- The user signs in again and re-verifies. Nothing is lost, because the
-- plaintext is still in the old column.

-- Written and cleared as a unit. A row with only the hash is a number that
-- cannot be shown back to its owner; a row with only the ciphertext is a number
-- that cannot be matched, so the person silently gets a second account on their
-- next sign-in. Both are corruption rather than a state to handle, so the
-- database refuses them outright.
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_phone_pair_check"
  CHECK (("phoneHash" IS NULL) = ("phoneEnc" IS NULL));

-- The live-only uniqueness moves to the hash. Same partial-index shape as
-- before, and for the same reason: a withdrawn row keeps its number, so the
-- constraint is "at most one *live* row per number". NULLs are exempt either
-- way, which is what lets an account exist before its SMS challenge completes.
DROP INDEX "UserProfile_phone_live_key";
CREATE UNIQUE INDEX "UserProfile_phoneHash_live_key"
  ON "UserProfile"("phoneHash")
  WHERE "withdrawnAt" IS NULL;

-- Kept as a plain index for the same reason the plaintext one was: the
-- live-only unique index above does not cover withdrawn rows, and support
-- lookups need to find those. Such a lookup now has to hash the number with
-- blindIndex() before querying — the column holds an HMAC, so a typed-in
-- `01012345678` matches nothing.
DROP INDEX "UserProfile_phone_idx";
CREATE INDEX "UserProfile_phoneHash_idx" ON "UserProfile"("phoneHash");

-- AuthIdentity.phone goes away rather than becoming a ciphertext. It was
-- non-authoritative support data that nothing read, and it was written from two
-- different sources (the provider's raw string vs. the normalized one) so its
-- format was already inconsistent. Encrypting it would have preserved the
-- inconsistency while removing the only reason to keep it.
ALTER TABLE "AuthIdentity" DROP COLUMN "phone";

-- PhoneVerification switches to the blind index. Existing rows are deleted
-- rather than converted: a row lives five minutes, and every one of them is
-- unusable after this migration anyway. The code hash folds the phone number in
-- and the number's format is changing, so an in-flight code could no longer
-- verify — it would surface to the user as "wrong code" *and* burn an attempt
-- from their budget, whereas an absent row surfaces as "request a code first",
-- which is what actually happened.
--
-- Deleting also makes the NOT NULL below possible: Postgres rejects a NOT NULL
-- column added to a table with existing rows and no default, and there is no
-- sensible default for a hash of a number nobody has.
DELETE FROM "PhoneVerification";

DROP INDEX "PhoneVerification_phone_createdAt_idx";
ALTER TABLE "PhoneVerification" DROP COLUMN "phone";
ALTER TABLE "PhoneVerification" ADD COLUMN "phoneHash" TEXT NOT NULL;
CREATE INDEX "PhoneVerification_phoneHash_createdAt_idx"
  ON "PhoneVerification"("phoneHash", "createdAt");
