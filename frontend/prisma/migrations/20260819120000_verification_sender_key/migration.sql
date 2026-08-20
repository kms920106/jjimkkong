-- Per-caller SMS send budget.
--
-- The existing limits on PhoneVerification are keyed on the destination number
-- (phoneHash) or on the attempt (purpose). Neither bounds one caller sending to
-- many different numbers: the per-number ceilings by definition cannot see
-- across numbers, and a phone-only sign-in mints its own `purpose` on the send
-- request itself, so discarding the challenge cookie resets that budget. This
-- column carries the one key on the row the caller does not get to choose.
--
-- Nullable: existing rows have no address recorded, and a caller whose IP the
-- platform does not supply still has to be able to sign in.
ALTER TABLE "PhoneVerification" ADD COLUMN "senderKey" TEXT;

-- Counted on every send, so it must be indexed — this is the table that grows
-- with every login attempt in the system.
CREATE INDEX "PhoneVerification_senderKey_createdAt_idx"
  ON "PhoneVerification" ("senderKey", "createdAt");
