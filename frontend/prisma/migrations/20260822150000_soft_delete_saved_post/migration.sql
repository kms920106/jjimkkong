-- Deleting a saved link becomes a status change instead of a delete, matching
-- what 20260817140000_soft_delete_account already did for withdrawal.
--
-- The hard delete it replaces took SavedPostPlace rows with it through
-- onDelete: Cascade, so a post's places — including the memos the user wrote on
-- them and the position that makes /links number them as a route — were gone
-- with the row. Nothing recoverable survived.
--
-- Same consequence as the withdrawal migration: a soft-deleted row goes on
-- holding the sourceUrl it was created with, so @@unique([userId, sourceUrl])
-- would stop the user from ever saving that link again. Replaced by a partial
-- unique index scoped to live rows. Postgres supports these; Prisma's schema
-- language cannot express them, which is why it lives here and the schema
-- carries a plain @@index instead.

ALTER TABLE "SavedPost" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Many deleted rows may share a (userId, sourceUrl); at most one live row may
-- hold it. Re-saving a link the user previously deleted therefore inserts a new
-- row rather than failing — and the deleted one stays put.
DROP INDEX "SavedPost_userId_sourceUrl_key";
CREATE UNIQUE INDEX "SavedPost_userId_sourceUrl_live_key"
  ON "SavedPost"("userId", "sourceUrl")
  WHERE "deletedAt" IS NULL;

-- Every list read is (userId, deletedAt IS NULL) ordered by createdAt: the home
-- map, /links, the count on /settings, and GET /api/posts. Replaces
-- SavedPost_userId_createdAt_idx, which no longer covers the filter.
DROP INDEX "SavedPost_userId_createdAt_idx";
CREATE INDEX "SavedPost_userId_deletedAt_createdAt_idx"
  ON "SavedPost"("userId", "deletedAt", "createdAt");
