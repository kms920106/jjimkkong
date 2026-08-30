-- Favourite lists: a member's named collections of places, with optional
-- public sharing.
--
-- Two things here are deliberately NOT expressible in schema.prisma and must
-- stay in this file:
--
--  1. The partial unique index on the default list. "At most one live default
--     list per member" is scoped to `deletedAt IS NULL` for the same reason
--     Member.phoneHash's uniqueness is scoped to `withdrawnAt IS NULL`: a
--     soft-deleted row keeps its flag, and a plain unique would stop the
--     member ever getting a default list again. Prisma cannot express a
--     partial unique, so the schema declares a plain @@index and this is the
--     real constraint.
--
--  2. The CHECK on visibility for the default list. "내 장소" is created
--     implicitly by a one-tap save, so the member never saw a visibility
--     picker for it — publishing it would publish places they never chose to
--     share. The application refuses it too; this makes the database refuse it
--     as well, because the failure mode is silent exposure rather than an error.

CREATE TYPE "ListVisibility" AS ENUM ('PRIVATE', 'LINK', 'PUBLIC');

CREATE TABLE "PlaceList" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "memberSeq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT,
    "linkUrl" TEXT,
    "visibility" "ListVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaceList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaceListEntry" (
    "listId" INTEGER NOT NULL,
    "placeId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceListEntry_pkey" PRIMARY KEY ("listId","placeId")
);

CREATE UNIQUE INDEX "PlaceList_memberId_memberSeq_key" ON "PlaceList"("memberId", "memberSeq");
CREATE INDEX "PlaceList_memberId_deletedAt_createdAt_idx" ON "PlaceList"("memberId", "deletedAt", "createdAt");
CREATE INDEX "PlaceList_memberId_visibility_deletedAt_idx" ON "PlaceList"("memberId", "visibility", "deletedAt");

CREATE INDEX "PlaceListEntry_placeId_removedAt_idx" ON "PlaceListEntry"("placeId", "removedAt");
CREATE INDEX "PlaceListEntry_listId_removedAt_position_idx" ON "PlaceListEntry"("listId", "removedAt", "position");

-- See note 1 above: live-only, so a soft-deleted default does not block the
-- member from ever having one again.
CREATE UNIQUE INDEX "PlaceList_one_live_default_per_member"
    ON "PlaceList"("memberId")
    WHERE "isDefault" AND "deletedAt" IS NULL;

-- See note 2 above.
ALTER TABLE "PlaceList"
    ADD CONSTRAINT "PlaceList_default_is_private"
    CHECK (NOT "isDefault" OR "visibility" = 'PRIVATE');

ALTER TABLE "PlaceList" ADD CONSTRAINT "PlaceList_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlaceListEntry" ADD CONSTRAINT "PlaceListEntry_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "PlaceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlaceListEntry" ADD CONSTRAINT "PlaceListEntry_placeId_fkey"
    FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;
