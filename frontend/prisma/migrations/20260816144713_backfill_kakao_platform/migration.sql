-- Kakao map links were stored as NAVER before the enum told the two vendors
-- apart. The canonical sourceUrl names the vendor outright, so the rows can be
-- moved without guessing.
--
-- Separate from the migration that adds 'KAKAO': Postgres refuses to use a new
-- enum value in the same transaction that created it.
UPDATE "SavedPost"
SET "platform" = 'KAKAO'
WHERE "platform" = 'NAVER'
  AND "sourceUrl" LIKE 'https://place.map.kakao.com/%';
