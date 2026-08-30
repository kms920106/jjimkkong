-- The unguessable half of a shared list's URL.
--
-- Implements the rule that a 일부 공개 list nobody has actually shared is not
-- reachable: the token is minted on the first 공유 press, so "never shared"
-- and "no address exists" are the same state rather than two that can drift.
--
-- It also closes an enumeration hole the previous address had. `/u/<memberId>/
-- <memberSeq>` is two small sequential integers, so anyone could have walked
-- other members' link-shared lists by counting; a token cannot be counted to.
--
-- Nullable, and the null is meaningful — see the column's note in
-- schema.prisma. Unique so it can address a row on its own.
ALTER TABLE "PlaceList" ADD COLUMN "shareToken" TEXT;

CREATE UNIQUE INDEX "PlaceList_shareToken_key" ON "PlaceList"("shareToken");
