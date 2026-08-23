-- Splits the old SavedPost into the post the platform published (Post, shared
-- by everyone) and one member's bookmark of it (Bookmark), gives creators a row
-- of their own (Author), and renames UserProfile to Member.
--
-- Why the split: every member who pasted the same link paid the whole ingest
-- pipeline again — a crawl of a source that blocks us, a model call, a round of
-- Naver lookups — to reach values another row already held. And `/author/1`
-- needs an author row to address.
--
-- Why the renames: the old names described the storage, not the domain.
-- "SavedPost" was doing two jobs at once, which is exactly what this migration
-- separates; "UserProfile" named a table rather than the person using the
-- service. See docs/domain/ubiquitous-language.md.
--
-- The data move is pure restructuring, so it happens here rather than in a
-- backfill script: unlike the phone-encryption migration, nothing here needs an
-- application key to compute.
--
-- ONE PREREQUISITE, and it must be done first. A member may hold several rows
-- for one sourceUrl: the old uniqueness was a *partial* index scoped to live
-- rows (20260822150000_soft_delete_saved_post), because a soft-deleted row keeps
-- its sourceUrl and a member has to be able to save a link they once deleted.
-- That deliberately permits several rows per URL as long as at most one is live.
--
-- This migration changes that rule — a re-save now revives the row it finds
-- instead of inserting beside it — and the real unique at the end of this file
-- cannot be created while those duplicates exist.
--
-- Resolving them removes rows, so it is NOT done here and NOT done by a script.
-- Every automated path is refused on purpose: the pre-tool hook rejects row
-- destruction in a migration, and withDeleteGuard() rejects it from application
-- code including raw SQL. This repository's DATABASE_URL points at live
-- Supabase, so the deletion is applied by hand, after review, against a list of
-- explicit ids — never a predicate that could match more than was inspected.
--
-- Find the groups:
--
--   SELECT s."id", s."userId", s."sourceUrl", s."deletedAt", s."createdAt",
--          (SELECT count(*) FROM "SavedPostPlace" p
--            WHERE p."postId" = s."id" AND p."memo" IS NOT NULL) AS memos
--   FROM "SavedPost" s
--   WHERE (s."userId", s."sourceUrl") IN (
--     SELECT "userId", "sourceUrl" FROM "SavedPost" GROUP BY 1,2 HAVING count(*) > 1)
--   ORDER BY s."userId", s."sourceUrl", s."createdAt";
--
-- Keep, per group: the live row if there is one, else the row carrying the most
-- memos, else the newest. The memo term is load-bearing rather than a
-- tie-breaker — when this migration was written every duplicate pair had the
-- *newer* row empty (a re-save that recorded nothing) and the older row holding
-- the note, so ordering by recency alone would have dropped the only copy of the
-- member's own writing. If a row being dropped carries memos the survivor lacks,
-- copy them across first; the cascade takes SavedPostPlace rows with it.
--
-- Against the data this was written for, that reduced to two rows — both
-- `__probe_` test URLs, both already soft-deleted, both with no places and no
-- memos, so nothing had to be carried over.

-- ---------------------------------------------------------------------------
-- UserProfile -> Member.
--
-- A rename, not a copy: renaming carries the rows, the primary key, every
-- foreign key pointing at it, and the partial unique index on phoneHash without
-- touching data. Recreating the table would have meant re-establishing all of
-- those, and the phoneHash index is the account-merge invariant.
-- ---------------------------------------------------------------------------

ALTER TABLE "UserProfile" RENAME TO "Member";

ALTER TABLE "Member" RENAME CONSTRAINT "UserProfile_pkey" TO "Member_pkey";

ALTER INDEX "UserProfile_phoneHash_idx" RENAME TO "Member_phoneHash_idx";
-- The live-only uniqueness from 20260817140000_soft_delete_account. Renamed
-- rather than rebuilt: it is what stops one phone number from owning two live
-- accounts, and dropping it even briefly opens that window.
ALTER INDEX "UserProfile_phoneHash_live_key" RENAME TO "Member_phoneHash_live_key";
ALTER INDEX "UserProfile_withdrawnAt_idx" RENAME TO "Member_withdrawnAt_idx";
-- The CHECK that refuses a half-sealed phone: a row with phoneHash but no
-- phoneEnc cannot be shown back to its owner, and one with phoneEnc but no
-- phoneHash never matches, so the next sign-in quietly creates a second account.
ALTER TABLE "Member" RENAME CONSTRAINT "UserProfile_phone_pair_check" TO "Member_phone_pair_check";

ALTER TABLE "AuthIdentity" RENAME COLUMN "userId" TO "memberId";
ALTER TABLE "AuthIdentity" RENAME CONSTRAINT "AuthIdentity_userId_fkey" TO "AuthIdentity_memberId_fkey";
ALTER INDEX "AuthIdentity_userId_idx" RENAME TO "AuthIdentity_memberId_idx";

ALTER TABLE "Session" RENAME COLUMN "userId" TO "memberId";
ALTER TABLE "Session" RENAME CONSTRAINT "Session_userId_fkey" TO "Session_memberId_fkey";
ALTER INDEX "Session_userId_idx" RENAME TO "Session_memberId_idx";

-- ---------------------------------------------------------------------------
-- Author: one row per (platform, handle) that any post named.
-- ---------------------------------------------------------------------------

CREATE TABLE "Author" (
    "id"          SERIAL       NOT NULL,
    "platform"    "Platform"   NOT NULL,
    "handle"      TEXT         NOT NULL,
    "image"       TEXT,
    "imageSource" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- No DEFAULT, matching every other `@updatedAt` column in this database: a
    -- default Prisma would not generate is drift. The cost is that raw SQL has
    -- to supply the value — see the INSERT below, which failed without it.
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Author_platform_handle_key" ON "Author"("platform", "handle");

-- The avatar comes from the most recent post by that handle: an author who
-- changed their picture should end up with the current one, and the newest save
-- is the closest thing this app has to "current". DISTINCT ON requires the
-- ORDER BY to lead with the same expressions it distinguishes on.
-- `updatedAt` is supplied explicitly, and leaving it out is what made the first
-- attempt at this migration fail with 23502. `@updatedAt` is a *Prisma client*
-- feature: the client fills the column on every write it performs, and the
-- generated DDL therefore carries no DEFAULT. Raw SQL in a migration is not the
-- client, so nothing fills it here.
--
-- Set to `createdAt` rather than now(): these rows are being reconstructed from
-- data that already existed, so "last updated" is when that data was last
-- written, not when the migration ran.
INSERT INTO "Author" ("platform", "handle", "image", "imageSource", "createdAt", "updatedAt")
SELECT DISTINCT ON ("platform", "author")
       "platform", "author", "authorImage", "authorImageSource",
       "createdAt", "createdAt"
FROM "SavedPost"
WHERE "author" IS NOT NULL
ORDER BY "platform", "author", "createdAt" DESC;

-- ---------------------------------------------------------------------------
-- Post: one row per canonical sourceUrl.
-- ---------------------------------------------------------------------------

CREATE TABLE "Post" (
    "id"              SERIAL       NOT NULL,
    "sourceUrl"       TEXT         NOT NULL,
    "platform"        "Platform"   NOT NULL,
    "title"           TEXT,
    "caption"         TEXT,
    "thumbnail"       TEXT,
    "thumbnailSource" TEXT,
    "authorId"        INTEGER,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Post_sourceUrl_key" ON "Post"("sourceUrl");
CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");
CREATE INDEX "Post_thumbnail_idx" ON "Post"("thumbnail");

ALTER TABLE "Post"
    ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId")
    REFERENCES "Author"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Two members who saved the same link have two rows to collapse into one Post.
-- The newest wins for every field: it is the most recent successful read of that
-- page, so it is the one most likely to hold a live thumbnail and a caption that
-- was not truncated by a block.
INSERT INTO "Post" (
    "sourceUrl", "platform", "title", "caption",
    "thumbnail", "thumbnailSource", "authorId", "createdAt"
)
SELECT DISTINCT ON (s."sourceUrl")
       s."sourceUrl", s."platform", s."title", s."caption",
       s."thumbnail", s."thumbnailSource", a."id", s."createdAt"
FROM "SavedPost" s
LEFT JOIN "Author" a
       ON a."platform" = s."platform" AND a."handle" = s."author"
ORDER BY s."sourceUrl", s."createdAt" DESC;

-- ---------------------------------------------------------------------------
-- PostPlace: the creator's place list and its order.
-- ---------------------------------------------------------------------------

CREATE TABLE "PostPlace" (
    "postId"   INTEGER NOT NULL,
    "placeId"  TEXT    NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PostPlace_pkey" PRIMARY KEY ("postId", "placeId")
);

CREATE INDEX "PostPlace_placeId_idx" ON "PostPlace"("placeId");

ALTER TABLE "PostPlace"
    ADD CONSTRAINT "PostPlace_postId_fkey" FOREIGN KEY ("postId")
    REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostPlace"
    ADD CONSTRAINT "PostPlace_placeId_fkey" FOREIGN KEY ("placeId")
    REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Collapsing several members' saves of one link can name the same place twice,
-- so one row per (post, place) wins. The lowest position wins rather than the
-- newest row's: position is the creator's ordering, identical in every save of
-- the same post, so a disagreement is noise from a re-ingest that found fewer
-- places — and the lower index is the one from the fuller read.
INSERT INTO "PostPlace" ("postId", "placeId", "position")
SELECT p."id", spp."placeId", MIN(spp."position")
FROM "SavedPostPlace" spp
JOIN "SavedPost" s ON s."id" = spp."postId"
JOIN "Post" p ON p."sourceUrl" = s."sourceUrl"
GROUP BY p."id", spp."placeId";

-- ---------------------------------------------------------------------------
-- SavedPost -> Bookmark, reduced to the member's own columns.
-- ---------------------------------------------------------------------------

ALTER TABLE "SavedPost" RENAME TO "Bookmark";
ALTER TABLE "Bookmark" RENAME CONSTRAINT "SavedPost_pkey" TO "Bookmark_pkey";
ALTER TABLE "Bookmark" RENAME COLUMN "userId" TO "memberId";
ALTER TABLE "Bookmark" RENAME CONSTRAINT "SavedPost_userId_fkey" TO "Bookmark_memberId_fkey";

CREATE TABLE "BookmarkMemo" (
    "bookmarkId" TEXT NOT NULL,
    "placeId"    TEXT NOT NULL,
    "memo"       TEXT,

    CONSTRAINT "BookmarkMemo_pkey" PRIMARY KEY ("bookmarkId", "placeId")
);

CREATE INDEX "BookmarkMemo_placeId_idx" ON "BookmarkMemo"("placeId");

-- Only rows that actually carry a note: an empty memo is the absence of one, and
-- materializing it would put a row here for every place of every bookmark.
--
-- One row per (bookmark, place) already, since the source table is keyed that
-- way. The duplicate-collapsing prerequisite has already merged the memos of any
-- superseded rows onto their survivor, so nothing here has to choose between two
-- notes on the same place.
INSERT INTO "BookmarkMemo" ("bookmarkId", "placeId", "memo")
SELECT spp."postId", spp."placeId", spp."memo"
FROM "SavedPostPlace" spp
JOIN "Bookmark" b ON b."id" = spp."postId"
WHERE spp."memo" IS NOT NULL;

ALTER TABLE "BookmarkMemo"
    ADD CONSTRAINT "BookmarkMemo_bookmarkId_fkey" FOREIGN KEY ("bookmarkId")
    REFERENCES "Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookmarkMemo"
    ADD CONSTRAINT "BookmarkMemo_placeId_fkey" FOREIGN KEY ("placeId")
    REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Bookmark" ADD COLUMN "postId"    INTEGER;
ALTER TABLE "Bookmark" ADD COLUMN "memberSeq" INTEGER;

UPDATE "Bookmark" b
SET "postId" = p."id"
FROM "Post" p
WHERE p."sourceUrl" = b."sourceUrl";

-- Oldest bookmark gets 1, so a member's numbering reads in the order they saved.
UPDATE "Bookmark" b
SET "memberSeq" = n.seq
FROM (
    SELECT "id",
           row_number() OVER (PARTITION BY "memberId" ORDER BY "createdAt", "id") AS seq
    FROM "Bookmark"
) n
WHERE n."id" = b."id";

ALTER TABLE "Bookmark" ALTER COLUMN "postId"    SET NOT NULL;
ALTER TABLE "Bookmark" ALTER COLUMN "memberSeq" SET NOT NULL;

-- The old place-link table. Its two halves are now PostPlace (the creator's
-- list, shared) and BookmarkMemo (the member's notes), both populated above.
--
-- Renamed rather than dropped, and **declared in schema.prisma as
-- SavedPostPlacePreSplit**. Both halves of that matter.
--
-- Kept because it is the only remaining record of the pre-split shape and
-- dropping it is irreversible against live data. Declared because a table the
-- database has and the schema does not is *drift* — `prisma migrate dev` would
-- report it on every run and offer a reset, which against this repository's live
-- Supabase URL is the irreversible operation CLAUDE.md exists to prevent. A
-- retained table has to be a table Prisma knows about, or the retention costs
-- more than it saves.
--
-- A later migration retires it, and that migration is the one that also removes
-- the model.
ALTER TABLE "SavedPostPlace" RENAME TO "_SavedPostPlace_pre_split";
-- Its primary key is renamed so nothing collides with a future
-- PostPlace/BookmarkMemo constraint and the retained table reads as retired.
ALTER TABLE "_SavedPostPlace_pre_split" RENAME CONSTRAINT "SavedPostPlace_pkey" TO "_SavedPostPlace_pre_split_pkey";

-- Its foreign keys go, and that is what makes the table genuinely inert rather
-- than merely unread. Two reasons, both load-bearing:
--
-- 1. The schema declares this model with no relations (it must not join to
--    anything), so constraints the database has and the schema does not are the
--    same drift the dropped columns were.
-- 2. `postId` pointed at what is now `Bookmark`. Leaving it would mean these
--    retired rows *restrict* deletes on a live table — a retention safeguard
--    that constrains current behaviour is no longer a safeguard.
ALTER TABLE "_SavedPostPlace_pre_split" DROP CONSTRAINT "SavedPostPlace_postId_fkey";
ALTER TABLE "_SavedPostPlace_pre_split" DROP CONSTRAINT "SavedPostPlace_placeId_fkey";

-- Everything the platform published now lives on Post, so these columns go.
--
-- **They are dropped rather than kept, and that is a correction.** Keeping them
-- looked safer — they are the pre-split record and a drop is irreversible — but
-- the values were all copied into Post/PostPlace/BookmarkMemo earlier in this
-- same transaction, so they are a *duplicate* record, not the only one. What
-- keeping them actually bought was nine columns the database has and
-- schema.prisma does not: permanent `prisma migrate dev` drift against live
-- Supabase, i.e. the reset prompt CLAUDE.md is written to keep anyone from
-- reaching for. That is a worse trade than the rollback window it protected.
--
-- The `_SavedPostPlace_pre_split` table above is kept for real, because its
-- memo/position rows are the one thing a botched split could not reconstruct —
-- and it is declared in the schema so it does not drift either.
DROP INDEX IF EXISTS "SavedPost_userId_sourceUrl_live_key";
DROP INDEX IF EXISTS "SavedPost_userId_deletedAt_author_idx";
DROP INDEX IF EXISTS "SavedPost_userId_deletedAt_createdAt_idx";
DROP INDEX IF EXISTS "SavedPost_thumbnail_idx";
-- `SavedPost_userId_sourceUrl_idx` is deliberately absent from that list. The
-- schema declared `@@index([userId, sourceUrl])`, but Prisma only ever
-- materialised that key as a unique (`..._key`, then `..._live_key`) — no index
-- by that name was created, so dropping it would be a no-op standing in for a
-- fact worth knowing: that declared index never existed.

ALTER TABLE "Bookmark"
    DROP COLUMN "sourceUrl",
    DROP COLUMN "platform",
    DROP COLUMN "title",
    DROP COLUMN "caption",
    DROP COLUMN "thumbnail",
    DROP COLUMN "thumbnailSource",
    DROP COLUMN "author",
    DROP COLUMN "authorImage",
    DROP COLUMN "authorImageSource";

-- A real unique, not the partial index it replaces: a re-save now clears
-- `deletedAt` on the row it finds instead of inserting beside it, which is what
-- restores the member's memos and keeps their /links/<memberSeq> URL working.
CREATE UNIQUE INDEX "Bookmark_memberId_postId_key" ON "Bookmark"("memberId", "postId");
CREATE UNIQUE INDEX "Bookmark_memberId_memberSeq_key" ON "Bookmark"("memberId", "memberSeq");
CREATE INDEX "Bookmark_memberId_deletedAt_createdAt_idx"
    ON "Bookmark"("memberId", "deletedAt", "createdAt");

ALTER TABLE "Bookmark"
    ADD CONSTRAINT "Bookmark_postId_fkey" FOREIGN KEY ("postId")
    REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
