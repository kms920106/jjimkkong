/**
 * Exercises the SavedPost soft delete against the real database.
 *
 * There is no test suite in this repository, and everything this change could
 * actually get wrong sits at the database boundary: whether the partial unique
 * index really permits re-saving a deleted link, whether the blob reference
 * count still reaches zero now that a deleted row survives to be counted.
 * Typechecking proves none of that.
 *
 * The client is wrapped in the guard exactly as the app's is, because the point
 * is to exercise what production runs — including watching the guard refuse a
 * delete.
 *
 * **This script leaves its probe rows behind, soft-deleted.** Not an oversight:
 * it has no way to remove them, because nothing here may hard-delete a
 * SavedPost, and carving a hole for a verification script would compromise the
 * thing being verified. Two soft-deleted rows, invisible to every read path,
 * are cheaper than that hole. Each run uses a fresh sourceUrl so repeat runs
 * never collide.
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
  const user = await prisma.userProfile.findFirst({
    where: { withdrawnAt: null },
    select: { id: true },
  });
  const place = await prisma.place.findFirst({ select: { id: true } });
  if (!user || !place) {
    console.log("No live UserProfile or Place to probe with; nothing verified.");
    await raw.$disconnect();
    return;
  }

  // ---- 1. A new save starts live and is visible ----
  const first = await prisma.savedPost.create({
    data: {
      userId: user.id,
      sourceUrl: SOURCE_URL,
      platform: Platform.INSTAGRAM,
      title: "probe",
      thumbnail: THUMB,
    },
  });
  await prisma.savedPostPlace.create({
    data: { postId: first.id, placeId: place.id, position: 0, memo: "probe memo" },
  });
  check("a new save starts live", first.deletedAt === null);

  const liveBefore = await prisma.savedPost.count({
    where: { userId: user.id, sourceUrl: SOURCE_URL, deletedAt: null },
  });
  check("live reads see it", liveBefore === 1, `count=${liveBefore}`);

  // ---- 2. A second LIVE row for the same link is still refused ----
  let duplicateRefused = false;
  try {
    await prisma.savedPost.create({
      data: { userId: user.id, sourceUrl: SOURCE_URL, platform: Platform.INSTAGRAM },
    });
  } catch {
    duplicateRefused = true;
  }
  check("partial unique index still refuses a second live row", duplicateRefused);

  // ---- 3. The guard refuses to hard-delete it ----
  let guarded = false;
  try {
    await prisma.savedPost.delete({ where: { id: first.id } });
  } catch (error) {
    guarded = error instanceof HardDeleteBlockedError;
  }
  check("runtime guard refuses a hard delete", guarded);

  // ---- 4. Soft delete, as DELETE /api/posts/[id] now does ----
  await prisma.savedPost.update({
    where: { id: first.id },
    data: { deletedAt: new Date() },
  });

  const liveAfter = await prisma.savedPost.count({
    where: { userId: user.id, sourceUrl: SOURCE_URL, deletedAt: null },
  });
  check("live reads stop seeing it", liveAfter === 0, `count=${liveAfter}`);

  const survivor = await prisma.savedPost.findUnique({
    where: { id: first.id },
    select: { deletedAt: true },
  });
  check("the row survives with deletedAt stamped", survivor?.deletedAt != null);

  // ---- 5. Its places survive, so a restore would be possible ----
  const link = await prisma.savedPostPlace.findFirst({
    where: { postId: first.id },
    select: { memo: true },
  });
  check("SavedPostPlace and its memo survive", link?.memo === "probe memo");

  // ---- 6. The sources route's relation filter hides it from strangers ----
  const strangerVisible = await prisma.savedPostPlace.count({
    where: { placeId: place.id, postId: first.id, post: { deletedAt: null } },
  });
  check(
    "the unauthenticated sources route no longer lists it",
    strangerVisible === 0,
    `count=${strangerVisible}`,
  );

  // ---- 7. What the partial index exists for: re-saving the same link ----
  const second = await prisma.savedPost.create({
    data: {
      userId: user.id,
      sourceUrl: SOURCE_URL,
      platform: Platform.INSTAGRAM,
      title: "probe again",
      thumbnail: THUMB,
    },
  });
  check("re-saving a deleted link succeeds", second.id !== first.id);

  // ---- 8. Blob reference counting ----
  // No deletedAt filter, deliberately: the soft-deleted row still points at the
  // blob and would render it if restored, so it counts as a reference.
  // Excluding only the row being removed, the total is 1 — the blob must NOT be
  // collected.
  const refs = await prisma.savedPost.count({
    where: { thumbnail: THUMB, id: { not: second.id } },
  });
  check(
    "the count includes the soft-deleted row, so the blob is kept",
    refs === 1,
    `count=${refs}`,
  );

  await prisma.savedPost.update({
    where: { id: second.id },
    data: { deletedAt: new Date() },
  });
  const refsIgnoringBoth = await prisma.savedPost.count({
    where: { thumbnail: THUMB, id: { notIn: [first.id, second.id] } },
  });
  check(
    "the count reaches zero when nothing else points at the blob",
    refsIgnoringBoth === 0,
    `count=${refsIgnoringBoth}`,
  );

  console.log(results.join("\n"));
  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}\n` +
      `Left behind, soft-deleted and invisible to every read path: ${first.id}, ${second.id}`,
  );
  if (failures > 0) process.exitCode = 1;
  await raw.$disconnect();
}

main();
