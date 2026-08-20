-- Password login for phone-number accounts.
--
-- Nullable, and null is the common case rather than an edge one: provider
-- sign-ins and SMS-only sign-ins both produce accounts with no password, and
-- both keep working untouched. Nothing backfills this column.
--
-- On the profile rather than keyed to the phone number, because the number is
-- the account-merge key: a credential attached to it would follow the number
-- into a merged account, and a recycled mobile number would carry the previous
-- owner's password to the next one.
ALTER TABLE "UserProfile" ADD COLUMN "passwordHash" TEXT;

-- Brute-force budget for password sign-in.
--
-- Password attempts send no SMS, so none of the PhoneVerification limits see them;
-- an unauthenticated, free-to-call login endpoint needs a counter of its own or it
-- is an unlimited guessing oracle.
--
-- No foreign key to "UserProfile" on purpose: attempts against numbers with no
-- account have to be counted as well, otherwise probing for which numbers exist is
-- unbudgeted.
CREATE TABLE "PasswordAttempt" (
  "id" TEXT NOT NULL,
  "senderKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordAttempt_pkey" PRIMARY KEY ("id")
);

-- Backs the windowed count that runs on every attempt.
CREATE INDEX "PasswordAttempt_senderKey_createdAt_idx"
  ON "PasswordAttempt" ("senderKey", "createdAt");

-- For sweeping rows older than the window.
CREATE INDEX "PasswordAttempt_createdAt_idx" ON "PasswordAttempt" ("createdAt");
