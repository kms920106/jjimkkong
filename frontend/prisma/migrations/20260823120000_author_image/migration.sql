-- The author's avatar, and the CDN URL it was copied from.
--
-- Two columns rather than one for the same reason `thumbnail`/`thumbnailSource`
-- are two: `authorImage` is always "the URL to render" so no consumer needs a
-- fallback expression, and a non-null `authorImageSource` is the predicate for
-- "this row's avatar is a blob of ours".
ALTER TABLE "SavedPost" ADD COLUMN "authorImage" TEXT;
ALTER TABLE "SavedPost" ADD COLUMN "authorImageSource" TEXT;

-- Backs /links/author/[author]: one author's live posts for one user. The
-- (userId, deletedAt) prefix matches every other list read in the app.
CREATE INDEX "SavedPost_userId_deletedAt_author_idx"
  ON "SavedPost" ("userId", "deletedAt", "author");
