-- Makes an SMS proof single-use for password writes.
--
-- "consumedAt" already marks a code as redeemed, but redemption returns a signed
-- cookie that the password step reads on a later request. A caller who keeps that
-- cookie could therefore set a password again and again until it expired — the
-- proof was reusable even though the code was not. The password routes now claim
-- this column with a conditional UPDATE, so one proof buys exactly one write.
ALTER TABLE "PhoneVerification" ADD COLUMN "spentAt" TIMESTAMP(3);
