/**
 * Checks the favourite-list invariants against the live database.
 *
 * A script rather than a test suite because this repository has none, and
 * because the things worth checking here are all database behaviour — the
 * partial unique index, the CHECK constraint, the soft delete's revival, and
 * the runtime guard's refusal to hard-delete an entry. None of those can be
 * observed without a real Postgres.
 *
 * Leaves its probe rows behind (soft-deleted), exactly as
 * `verify-soft-delete.ts` does: cleaning up would mean the hard deletes this
 * repository forbids.
 *
 *   npx tsx --env-file=.env scripts/verify-place-lists.ts
 */
import { prisma } from "../src/lib/prisma";
import { HardDeleteBlockedError } from "../src/lib/prisma-guard";
import {
  addPlaceToList,
  createList,
  deleteList,
  ensureDefaultList,
  listSeqsContaining,
  publicListsOf,
  ensureShareToken,
  readListByShareToken,
  readPublicList,
  removePlaceFromList,
  updateList,
} from "../src/lib/place-list";
import { DEFAULT_LIST_COLOR } from "../src/lib/place-list/palette";
import { ListVisibility } from "../src/generated/prisma/enums";
import { ListNotSharableError } from "../src/lib/place-list";

let failures = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`, detail ?? "");
  }
}

async function main() {
  const member = await prisma.member.findFirst({
    where: { withdrawnAt: null },
    orderBy: { id: "asc" },
  });
  const place = await prisma.place.findFirst({ orderBy: { id: "asc" } });
  if (!member || !place) {
    console.error("Needs at least one live member and one place. Aborting.");
    process.exit(1);
  }
  console.log(`member=${member.id} place=${place.id}\n`);

  console.log("default list");
  const first = await ensureDefaultList(member.id);
  const second = await ensureDefaultList(member.id);
  check("is created once and reused", first.id === second.id);
  check("is private", first.visibility === ListVisibility.PRIVATE);

  // The partial unique index is what makes the above true under concurrency,
  // so assert it directly rather than trusting the read-then-create above.
  let blockedSecondDefault = false;
  try {
    await prisma.placeList.create({
      data: {
        memberId: member.id,
        memberSeq: 9_000_000,
        name: "second default",
        color: DEFAULT_LIST_COLOR,
        isDefault: true,
      },
    });
  } catch {
    blockedSecondDefault = true;
  }
  check("a second live default is refused by the index", blockedSecondDefault);

  // The CHECK constraint: the implicit list must not become shareable, because
  // the member never saw a visibility picker for it.
  let blockedPublicDefault = false;
  try {
    await prisma.placeList.update({
      where: { id: first.id },
      data: { visibility: ListVisibility.PUBLIC },
    });
  } catch {
    blockedPublicDefault = true;
  }
  check("a public default is refused by the CHECK", blockedPublicDefault);

  let lockedRename = false;
  try {
    await updateList(member.id, first.memberSeq, { name: "바뀐 이름" });
  } catch {
    lockedRename = true;
  }
  check("the default refuses a rename", lockedRename);

  let lockedDelete = false;
  try {
    await deleteList(member.id, first.memberSeq);
  } catch {
    lockedDelete = true;
  }
  check("the default refuses deletion", lockedDelete);

  console.log("\nentries and the soft delete");
  const list = await createList(member.id, {
    name: `probe ${Date.now()}`,
    color: DEFAULT_LIST_COLOR,
    description: null,
    linkUrl: null,
    visibility: ListVisibility.PRIVATE,
  });

  await addPlaceToList(list.id, place.id, "probe memo");
  check(
    "the place is reported as contained",
    (await listSeqsContaining(member.id, place.id)).includes(list.memberSeq),
  );

  await removePlaceFromList(member.id, list.memberSeq, place.id);
  check(
    "removal hides it from the containing set",
    !(await listSeqsContaining(member.id, place.id)).includes(list.memberSeq),
  );

  const removed = await prisma.placeListEntry.findUnique({
    where: { listId_placeId: { listId: list.id, placeId: place.id } },
  });
  check("the row survives removal", removed !== null);
  check("the memo survives removal", removed?.memo === "probe memo");

  // The point of the soft delete: a one-tap re-add must bring the note back,
  // and must not overwrite it with the null the one-tap path sends.
  await addPlaceToList(list.id, place.id, null);
  const revived = await prisma.placeListEntry.findUnique({
    where: { listId_placeId: { listId: list.id, placeId: place.id } },
  });
  check("re-adding revives the entry", revived?.removedAt === null);
  check("re-adding keeps the old memo", revived?.memo === "probe memo");

  // The runtime guard must refuse a hard delete of an entry, because the row
  // carries the member's note. (Permitted from a scripts/verify-* file — see
  // the hook's documented exceptions.)
  let guarded = false;
  try {
    await prisma.placeListEntry.deleteMany({ where: { listId: list.id } });
  } catch (error) {
    guarded = error instanceof HardDeleteBlockedError;
  }
  check("the runtime guard blocks hard-deleting entries", guarded);

  console.log("\nvisibility: 비공개");
  check(
    "a private list is not at the discoverable address",
    (await readPublicList(member.id, list.memberSeq)) === null,
  );
  let refusedPrivateShare = false;
  try {
    await ensureShareToken(member.id, list.memberSeq);
  } catch (error) {
    refusedPrivateShare = error instanceof ListNotSharableError;
  }
  check("a private list refuses to mint a share token", refusedPrivateShare);

  console.log("\nvisibility: 일부 공개");
  await updateList(member.id, list.memberSeq, {
    visibility: ListVisibility.LINK,
  });

  // The rule this whole token mechanism exists for: setting 일부 공개 is not
  // itself an act of sharing, so the list must still be unreachable.
  check(
    "a link-shared list that was never shared has no token",
    (
      await prisma.placeList.findUnique({
        where: { id: list.id },
        select: { shareToken: true },
      })
    )?.shareToken === null,
  );
  check(
    "a link-shared list is NOT at the discoverable address",
    (await readPublicList(member.id, list.memberSeq)) === null,
  );
  check(
    "a link-shared list is NOT on the public index",
    !(await publicListsOf(member.id)).some((l) => l.seq === list.memberSeq),
  );

  const token = await ensureShareToken(member.id, list.memberSeq);
  check("pressing 공유 mints a token", token.length === 32);
  check(
    "the token opens the list",
    (await readListByShareToken(token)) !== null,
  );
  check(
    "pressing 공유 again returns the same token",
    (await ensureShareToken(member.id, list.memberSeq)) === token,
  );
  check(
    "a link-shared list is still NOT at the discoverable address",
    (await readPublicList(member.id, list.memberSeq)) === null,
  );
  check(
    "a link-shared list is still NOT on the public index",
    !(await publicListsOf(member.id)).some((l) => l.seq === list.memberSeq),
  );

  console.log("\nvisibility: 전체 공개");
  await updateList(member.id, list.memberSeq, {
    visibility: ListVisibility.PUBLIC,
  });
  check(
    "a public list IS on the public index",
    (await publicListsOf(member.id)).some((l) => l.seq === list.memberSeq),
  );
  check(
    "a public list IS at the discoverable address",
    (await readPublicList(member.id, list.memberSeq)) !== null,
  );
  check(
    "a public list is still reachable by its existing token",
    (await readListByShareToken(token)) !== null,
  );

  console.log("\nback to 비공개 revokes every shared link");
  await updateList(member.id, list.memberSeq, {
    visibility: ListVisibility.PRIVATE,
  });
  check(
    "an already-shared token stops resolving once private",
    (await readListByShareToken(token)) === null,
  );
  check(
    "the private list leaves the public index",
    !(await publicListsOf(member.id)).some((l) => l.seq === list.memberSeq),
  );
  // Re-opening must not invalidate links the owner already sent out.
  await updateList(member.id, list.memberSeq, {
    visibility: ListVisibility.LINK,
  });
  check(
    "re-opening restores the same link",
    (await readListByShareToken(token)) !== null,
  );

  console.log("\nlist soft delete");
  await deleteList(member.id, list.memberSeq);
  check(
    "a deleted list is gone from the public index",
    !(await publicListsOf(member.id)).some((l) => l.seq === list.memberSeq),
  );
  check(
    "a deleted list is no longer readable by its share link",
    (await readListByShareToken(token)) === null,
  );
  check(
    "a deleted list's entries stop filling the star",
    !(await listSeqsContaining(member.id, place.id)).includes(list.memberSeq),
  );

  // The number a deleted list holds must not be reissued, or the next create
  // violates the unique — the trap Bookmark.memberSeq documents.
  const next = await createList(member.id, {
    name: `probe seq ${Date.now()}`,
    color: DEFAULT_LIST_COLOR,
    description: null,
    linkUrl: null,
    visibility: ListVisibility.PRIVATE,
  });
  check(
    "memberSeq counts deleted lists too",
    next.memberSeq > list.memberSeq,
    { deleted: list.memberSeq, next: next.memberSeq },
  );
  await deleteList(member.id, next.memberSeq);

  console.log(
    failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
