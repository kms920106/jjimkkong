-- Restores two indexes that 20260825120000_int_ids dropped without meaning to.
--
-- That migration swapped `placeId` on PostPlace and BookmarkMemo from text to
-- int by dropping the old column and renaming a new one into place. `DROP
-- COLUMN` silently takes every index that column was part of — so
-- PostPlace_placeId_idx and BookmarkMemo_placeId_idx went with it, and nothing
-- recreated them. The file's own audit missed it because it only accounted for
-- indexes removed by an explicit `DROP INDEX`; these two were never named.
--
-- `prisma migrate diff --from-schema-datasource --to-schema-datamodel` is what
-- caught it, by comparing the live catalog against the schema instead of
-- against the migration's intent. Worth remembering as the check that sees this
-- class of loss: `migrate status` stayed clean the whole time, because the
-- journal was consistent — only the shape of the database was wrong.
--
-- Both are declared `@@index([placeId])` in schema.prisma, and both back real
-- reads: GET /api/places/[id]/sources queries PostPlace by placeId on every
-- place-sheet open, and BookmarkMemo is read by placeId when a bookmark's memos
-- are joined. Without them those are sequential scans over tables that grow
-- with every save.
--
-- Additive and safe to re-run behind IF NOT EXISTS: this repairs a gap rather
-- than changing a decision.

CREATE INDEX IF NOT EXISTS "PostPlace_placeId_idx" ON "PostPlace"("placeId");
CREATE INDEX IF NOT EXISTS "BookmarkMemo_placeId_idx" ON "BookmarkMemo"("placeId");

-- And one older gap the same diff surfaced, unrelated to the int migration.
--
-- The split migration renamed the table SavedPostPlace -> _SavedPostPlace_pre_split
-- and renamed its primary key, but left this index under its original name. It
-- has been reported as drift ever since; nothing noticed because the table is
-- deliberately unread, and `migrate status` never looks at index names.
--
-- Renamed rather than dropped and rebuilt: the index is valid, only its name is
-- stale, and a rename neither touches the rows nor opens a window where the
-- table is unindexed. Fixing it here means the next `migrate dev` on this
-- repository reports a clean diff — which is what stops someone from being
-- offered a reset against live Supabase for a cosmetic mismatch.
ALTER INDEX IF EXISTS "SavedPostPlace_placeId_idx"
  RENAME TO "_SavedPostPlace_pre_split_placeId_idx";
