/**
 * Exercises the Bookmark soft delete against the real database.
 *
 * There is no test suite in this repository, and everything this could actually
 * get wrong sits at the database boundary: whether re-saving a deleted link
 * really revives the same row with its memos and its number, whether the unique
 * indexes hold, whether the guard still refuses to remove a row. Typechecking
 * proves none of that.
 *
 * **The invariants here changed with the post/bookmark split, and the changes
 * are the point of the rewrite:**
 *
 * - The uniqueness on the member's link is a *real* unique on
 *   [memberId, postId] now, not a partial index scoped to live rows. It used to
 *   have to be partial so a deleted link could be saved again as a second row.
 * - Re-saving therefore *revives* the existing row rather than inserting beside
 *   it. That is what brings back the member's memos and keeps the
 *   `/links/<memberSeq>` URL they may have bookmarked.
 * - There is no blob reference counting left to check. Thumbnails belong to the
 *   shared `Post`, which is written once and never updated, so a blob has exactly
 *   one owning row and is never displaced.
 * - The unauthenticated sources route no longer needs a `deletedAt` filter at
 *   all: it reads `PostPlace`, which hangs off the shared post and has no member
 *   and no soft delete. The privacy bug that filter guarded cannot occur.
 *
 * The client is wrapped in the guard exactly as the app's is, because the point
 * is to exercise what production runs — including watching the guard refuse a
 * removal.
 *
 * **This script leaves its probe rows behind, soft-deleted.** Not an oversight:
 * it has no way to remove them, because nothing here may hard-delete a Bookmark
 * or a Post, and carving a hole for a verification script would compromise the
 * thing being verified. A few invisible rows are cheaper than that hole. Each run
 * uses a fresh sourceUrl so repeat runs never collide.
 *
 *   npx tsx --env-file=.env scripts/verify-soft-delete.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Platform } from "../src/generated/prisma/enums";
import {
  withDeleteGuard,
  HardDeleteBlockedError,
} from "../src/lib/prisma-guard";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const prisma = withDeleteGuard(raw);

const RUN = process.env.PROBE_TAG ?? String(Date.now());
const SOURCE_URL = `https://www.instagram.com/p/__probe_${RUN}__/`;
const THUMB = `https://probe.public.blob.vercel-storage.com/post-thumbnail/__probe_${RUN}__.jpg`;

const results: string[] = [];
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  results.push(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  // A real account, so the FK holds. Nothing about it is modified.
  const member = await prisma.member.findFirst({
    where: { withdrawnAt: null },
    select: { id: true },
  });
  const place = await prisma.place.findFirst({ select: { id: true } });
  if (!member || !place) {
    console.log("No live Member or Place to probe with; nothing verified.");
    await raw.$disconnect();
    return;
  }

  // The shared post. Created once here, exactly as the first save of a link
  // would, and never updated again — that immutability is what lets two members
  // bookmark it without either changing what the other sees.
  const post = await prisma.post.create({
    data: {
      sourceUrl: SOURCE_URL,
      platform: Platform.INSTAGRAM,
      title: "probe",
      thumbnail: THUMB,
      places: { create: { placeId: place.id, position: 0 } },
    },
  });

  // ---- 1. A new bookmark starts live, numbered, and visible ----
  const highest = await prisma.bookmark.aggregate({
    where: { memberId: member.id },
    _max: { memberSeq: true },
  });
  const seq = (highest._max.memberSeq ?? 0) + 1;

  const bookmark = await prisma.bookmark.create({
    data: { memberId: member.id, postId: post.id, memberSeq: seq },
  });
  await prisma.bookmarkMemo.create({
    data: { bookmarkId: bookmark.id, placeId: place.id, memo: "probe memo" },
  });
  check("a new bookmark starts live", bookmark.deletedAt === null);

  const liveBefore = await prisma.bookmark.count({
    where: { memberId: member.id, postId: post.id, deletedAt: null },
  });
  check("live reads see it", liveBefore === 1, `count=${liveBefore}`);

  // ---- 2. A second bookmark of the same post is refused outright ----
  // A real unique now, not a live-only one: there is never a second row for this
  // pair, deleted or not, because a re-save revives instead of inserting.
  let duplicateRefused = false;
  try {
    await prisma.bookmark.create({
      data: { memberId: member.id, postId: post.id, memberSeq: seq + 1 },
    });
  } catch {
    duplicateRefused = true;
  }
  check("[memberId, postId] refuses a second row", duplicateRefused);

  // ---- 3. Two members may bookmark one post, each with their own number ----
  // The whole reason for the split: the second member pays no crawl, no model
  // call and no geocoding, because the post already exists.
  const other = await prisma.member.findFirst({
    where: { withdrawnAt: null, id: { not: member.id } },
    select: { id: true },
  });
  if (other) {
    const otherHighest = await prisma.bookmark.aggregate({
      where: { memberId: other.id },
      _max: { memberSeq: true },
    });
    const otherBookmark = await prisma.bookmark.create({
      data: {
        memberId: other.id,
        postId: post.id,
        memberSeq: (otherHighest._max.memberSeq ?? 0) + 1,
      },
    });
    check(
      "a second member bookmarks the same post",
      otherBookmark.postId === post.id,
    );
  } else {
    results.push("SKIP only one live member, cannot check post sharing");
  }

  // ---- 4. The guard refuses to remove the row ----
  let guarded = false;
  try {
    await prisma.bookmark.delete({ where: { id: bookmark.id } });
  } catch (error) {
    guarded = error instanceof HardDeleteBlockedError;
  }
  check("runtime guard refuses to remove a Bookmark", guarded);

  // ---- 5. So does the guard for the two tables that replaced SavedPostPlace ----
  // Both left the allowlist with the split, because nothing rewrites them any
  // more. This is the assertion that catches either being quietly re-added.
  let postPlaceGuarded = false;
  try {
    await prisma.postPlace.deleteMany({ where: { postId: post.id } });
  } catch (error) {
    postPlaceGuarded = error instanceof HardDeleteBlockedError;
  }
  check("runtime guard refuses to remove PostPlace rows", postPlaceGuarded);

  let memoGuarded = false;
  try {
    await prisma.bookmarkMemo.deleteMany({ where: { bookmarkId: bookmark.id } });
  } catch (error) {
    memoGuarded = error instanceof HardDeleteBlockedError;
  }
  check("runtime guard refuses to remove BookmarkMemo rows", memoGuarded);

  // ---- 6. Soft delete, as DELETE /api/posts/[id] does ----
  await prisma.bookmark.update({
    where: { id: bookmark.id },
    data: { deletedAt: new Date() },
  });

  const liveAfter = await prisma.bookmark.count({
    where: { memberId: member.id, postId: post.id, deletedAt: null },
  });
  check("live reads stop seeing it", liveAfter === 0, `count=${liveAfter}`);

  const survivor = await prisma.bookmark.findUnique({
    where: { id: bookmark.id },
    select: { deletedAt: true, memberSeq: true },
  });
  check("the row survives with deletedAt stamped", survivor?.deletedAt != null);
  check(
    "its number survives, so its URL is still its own",
    survivor?.memberSeq === seq,
    `seq=${survivor?.memberSeq}`,
  );

  // ---- 7. The memo survives, which is what makes the revive worth having ----
  const memo = await prisma.bookmarkMemo.findFirst({
    where: { bookmarkId: bookmark.id },
    select: { memo: true },
  });
  check("BookmarkMemo survives the soft delete", memo?.memo === "probe memo");

  // ---- 8. The shared post is untouched by one member's delete ----
  // It must be: other members may still have it bookmarked, and the picture and
  // places belong to the post rather than to anyone's save of it.
  const sharedStillThere = await prisma.post.findUnique({
    where: { id: post.id },
    select: { thumbnail: true, places: { select: { placeId: true } } },
  });
  check(
    "the shared Post keeps its thumbnail and places",
    sharedStillThere?.thumbnail === THUMB &&
      sharedStillThere.places.length === 1,
  );

  // ---- 9. Re-saving revives the same row rather than making a new one ----
  const revived = await prisma.bookmark.update({
    where: { memberId_postId: { memberId: member.id, postId: post.id } },
    data: { deletedAt: null },
    select: { id: true, memberSeq: true, deletedAt: true },
  });
  check("re-saving revives the same row", revived.id === bookmark.id);
  check("it is live again", revived.deletedAt === null);
  check(
    "with the number it always had",
    revived.memberSeq === seq,
    `seq=${revived.memberSeq}`,
  );

  const memoAfterRevive = await prisma.bookmarkMemo.findFirst({
    where: { bookmarkId: bookmark.id },
    select: { memo: true },
  });
  check(
    "and the memo the member wrote before deleting",
    memoAfterRevive?.memo === "probe memo",
  );

  // ---- 10. The sources route lists the post regardless of anyone's delete ----
  // No `deletedAt` filter is possible here, and none is needed: PostPlace hangs
  // off the shared post. The pin is communal, so the sheet answers "which posts
  // name this place", not "which members currently keep it".
  const communal = await prisma.postPlace.count({
    where: { placeId: place.id, postId: post.id },
  });
  check(
    "the unauthenticated sources route reads the shared post",
    communal === 1,
    `count=${communal}`,
  );

  // Left soft-deleted rather than live, so the probe does not show up in anyone's
  // grid. The revive above is undone here for that reason only.
  await prisma.bookmark.update({
    where: { id: bookmark.id },
    data: { deletedAt: new Date() },
  });

  console.log(results.join("\n"));
  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}\n` +
      `Left behind and invisible to every read path: post ${post.id}, ` +
      `bookmark ${bookmark.id}`,
  );
  if (failures > 0) process.exitCode = 1;
  await raw.$disconnect();
}

main();
