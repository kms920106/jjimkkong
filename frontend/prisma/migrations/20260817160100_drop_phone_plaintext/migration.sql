-- Drops the plaintext phone column, once scripts/backfill-phone-encryption.ts
-- has sealed its contents into phoneHash + phoneEnc.
--
-- Separate from the migration that added those columns so the backfill has a
-- window to run in between. Applying both in one go against a database that
-- already holds numbers would delete them before anything could read them.
--
-- Running this with the backfill still pending is not an error the database can
-- catch: it just means those profiles lose their number and their owners
-- re-verify by SMS on the next sign-in. Nothing else breaks — a NULL phoneHash
-- is the same state as an account that has not completed its SMS challenge.

ALTER TABLE "UserProfile" DROP COLUMN "phone";
