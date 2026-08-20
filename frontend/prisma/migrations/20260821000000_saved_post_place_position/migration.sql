-- `/links` numbers a post's places as a route (a 데이트코스 is a sequence), but
-- SavedPostPlace had no ordering column: the write path sorts by name to keep
-- lock acquisition deterministic, and reads came back in the composite primary
-- key's order — i.e. by random cuid. Existing rows all take the default, so
-- their order stays arbitrary until the post is saved again; only new writes
-- carry the caption's sequence.
ALTER TABLE "SavedPostPlace" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
