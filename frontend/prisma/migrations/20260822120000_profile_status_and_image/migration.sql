-- Profile fields the edit page writes: a free-text line and a picture.
--
-- Both nullable with no default. Null is the absent state everywhere in the
-- app, and an empty submission is normalized back to null by the route rather
-- than stored as '' — one absent state instead of two.
--
-- `imageUrl` holds an absolute Vercel Blob URL, not image bytes. The picture is
-- served off the blob CDN, so it never passes through this row.
ALTER TABLE "UserProfile"
  ADD COLUMN "statusMessage" TEXT,
  ADD COLUMN "imageUrl" TEXT;
