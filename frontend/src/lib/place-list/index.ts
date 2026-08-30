import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { DEFAULT_LIST_COLOR } from "@/lib/place-list/palette";
import { ListVisibility } from "@/generated/prisma/enums";
import type {
  Place,
  PlaceList,
  PlaceListEntry,
} from "@/generated/prisma/client";
import type { PlaceListDTO, PlaceListSummaryDTO } from "@/lib/types";

/** Thrown when a list exists but the caller may not read or write it. */
export class ListNotFoundError extends Error {
  constructor() {
    super("리스트를 찾을 수 없습니다.");
    this.name = "ListNotFoundError";
  }
}

/** Thrown when 공유 is pressed on a list whose visibility is still PRIVATE. */
export class ListNotSharableError extends Error {
  constructor() {
    super("비공개 리스트는 공유할 수 없습니다. 공개 범위를 먼저 바꿔 주세요.");
    this.name = "ListNotSharableError";
  }
}

/**
 * Thrown when a write targets the implicit "내 장소" list in a way that would
 * break the guarantee that it always exists and stays private.
 */
export class DefaultListLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefaultListLockedError";
  }
}

/** The name the implicit list is created with; the UI refuses to rename it. */
export const DEFAULT_LIST_NAME = "내 장소";

/**
 * Every read of a list must go through one of these filters, and they move
 * together exactly like Bookmark's `deletedAt` filters do — see AGENTS.md.
 * Exported so the pages that query directly cannot spell it differently.
 */
export const liveList = { deletedAt: null } as const;

/**
 * The matching filter for entries. Separate from {@link liveList} because the
 * two columns live on different tables and mean different things: a list is
 * `deletedAt` when the member threw the whole list away, an entry is
 * `removedAt` when they un-favourited one place inside a list they kept.
 *
 * Every entry read uses this. The reads are: the list page, the summary counts,
 * `listSeqsContaining` (which fills the star), and the public list page.
 */
export const liveEntry = { removedAt: null } as const;

/**
 * The include clause `toPlaceListDTO` requires. Ordered by `position` for the
 * reason `bookmarkInclude` orders by it: without an explicit order the rows
 * come back in composite-primary-key order and the list silently reshuffles
 * between renders.
 */
export const placeListInclude = {
  entries: {
    where: liveEntry,
    include: { place: true },
    orderBy: { position: "asc" },
  },
} as const;

type PlaceListWithEntries = PlaceList & {
  entries: Array<PlaceListEntry & { place: Place }>;
};

/**
 * The full list, for its own page.
 *
 * `memberSeq` is exposed as `seq` and the row's own `id` is not, for the same
 * privacy reason `SavedPostDTO` does it: a global id in a URL publishes how
 * many lists the service holds. The one exception is the share URL, which must
 * address a list belonging to someone the viewer is not — see `shareToken`.
 */
export function toPlaceListDTO(list: PlaceListWithEntries): PlaceListDTO {
  return {
    seq: list.memberSeq,
    name: list.name,
    color: list.color,
    description: list.description,
    linkUrl: list.linkUrl,
    visibility: list.visibility,
    isDefault: list.isDefault,
    count: list.entries.length,
    createdAt: list.createdAt.toISOString(),
    places: list.entries.map((entry) => ({
      id: entry.place.id,
      name: entry.place.name,
      address: entry.place.address,
      lat: entry.place.lat,
      lng: entry.place.lng,
      category: entry.place.category,
      memo: entry.memo,
      // The list page renders pins and cards, not blog reviews — those hang off
      // the place sheet, which fetches them itself. Kept empty rather than
      // joined so this query does not pull five rows per place for a surface
      // that never shows them.
      blogs: [],
    })),
  };
}

/** The row as the picker and the index render it: no places, just the count. */
export function toPlaceListSummaryDTO(
  list: PlaceList & { _count: { entries: number } },
): PlaceListSummaryDTO {
  return {
    seq: list.memberSeq,
    name: list.name,
    color: list.color,
    description: list.description,
    visibility: list.visibility,
    isDefault: list.isDefault,
    count: list._count.entries,
  };
}

/**
 * The member's lists for the picker, newest first with "내 장소" pinned to the
 * top.
 *
 * The default is pinned rather than sorted by date because it is the one-tap
 * destination: a picker whose first row moves as the member creates lists makes
 * the common save a reading task.
 */
export async function listsForMember(
  memberId: number,
): Promise<PlaceListSummaryDTO[]> {
  const rows = await prisma.placeList.findMany({
    where: { memberId, ...liveList },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    // Counted with the same live filter the list page renders under, or the
    // picker would advertise a count the list does not show.
    include: { _count: { select: { entries: { where: liveEntry } } } },
  });
  return rows.map(toPlaceListSummaryDTO);
}

/**
 * The ids of the member's live lists that already contain `placeId`.
 *
 * What the star on the place sheet is filled from, and what the picker
 * pre-checks. Returns `memberSeq` values, not row ids, so the client never
 * holds a global id — the write routes address lists the same way.
 */
export async function listSeqsContaining(
  memberId: number,
  placeId: number,
): Promise<number[]> {
  const rows = await prisma.placeListEntry.findMany({
    where: { placeId, ...liveEntry, list: { memberId, ...liveList } },
    select: { list: { select: { memberSeq: true } } },
  });
  return rows.map((row) => row.list.memberSeq);
}

/**
 * Resolves one of the member's lists by its per-member number.
 *
 * Scoped by `memberId` and `deletedAt` in the same query rather than fetched
 * and checked afterwards: AGENTS.md's rule is that the ownership predicate goes
 * in the `where`, because a check that happens after the read is a check
 * someone will forget to write.
 */
export async function requireOwnedList(
  memberId: number,
  seq: number,
): Promise<PlaceList> {
  const list = await prisma.placeList.findFirst({
    where: { memberId, memberSeq: seq, ...liveList },
  });
  if (!list) throw new ListNotFoundError();
  return list;
}

/**
 * The member's "내 장소", created on first use.
 *
 * Created lazily rather than at sign-up so an account that never favourites
 * anything carries no row, and so existing accounts need no backfill. The
 * partial unique index is the arbiter if two concurrent one-tap saves both find
 * it missing — the loser retries the read and finds the winner's row.
 */
export async function ensureDefaultList(memberId: number): Promise<PlaceList> {
  const existing = await prisma.placeList.findFirst({
    where: { memberId, isDefault: true, ...liveList },
  });
  if (existing) return existing;

  try {
    return await createList(memberId, {
      name: DEFAULT_LIST_NAME,
      color: DEFAULT_LIST_COLOR,
      description: null,
      linkUrl: null,
      visibility: ListVisibility.PRIVATE,
      isDefault: true,
    });
  } catch {
    // Lost the race against a concurrent one-tap save. The winner's row is the
    // answer; re-reading is correct rather than surfacing a unique violation to
    // a user who only pressed a star.
    const winner = await prisma.placeList.findFirst({
      where: { memberId, isDefault: true, ...liveList },
    });
    if (!winner) throw new ListNotFoundError();
    return winner;
  }
}

/**
 * Creates a list, allocating its per-member number inside the transaction.
 *
 * `memberSeq` is MAX+1 over **every** row including soft-deleted ones. Filtering
 * them out would reissue a number a deleted list still holds and violate the
 * unique on every create after the first delete — the identical trap
 * `Bookmark.memberSeq` documents.
 */
export async function createList(
  memberId: number,
  input: {
    name: string;
    color: string;
    description: string | null;
    linkUrl: string | null;
    visibility: ListVisibility;
    isDefault?: boolean;
  },
): Promise<PlaceList> {
  return prisma.$transaction(async (tx) => {
    const last = await tx.placeList.findFirst({
      where: { memberId },
      orderBy: { memberSeq: "desc" },
      select: { memberSeq: true },
    });
    return tx.placeList.create({
      data: {
        memberId,
        memberSeq: (last?.memberSeq ?? 0) + 1,
        name: input.name,
        color: input.color,
        description: input.description,
        linkUrl: input.linkUrl,
        // The database CHECK refuses a non-private default as well; this keeps
        // the two from disagreeing rather than relying on callers.
        visibility: input.isDefault
          ? ListVisibility.PRIVATE
          : input.visibility,
        isDefault: input.isDefault ?? false,
      },
    });
  });
}

/**
 * Adds a place to a list, or updates the memo if it is already there.
 *
 * An upsert rather than a create so pressing save twice is not an error, and so
 * the picker can re-submit the whole selection without diffing it. `position`
 * is MAX+1 within the list, assigned only on insert — re-saving an existing
 * entry must not jump it to the end of a list the member has ordered.
 */
export async function addPlaceToList(
  listId: number,
  placeId: number,
  memo: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const last = await tx.placeListEntry.findFirst({
      // Over every row, live or removed: a removed entry keeps its position,
      // and reusing it would collide two entries onto the same slot in a list
      // the member has ordered.
      where: { listId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    await tx.placeListEntry.upsert({
      where: { listId_placeId: { listId, placeId } },
      create: {
        listId,
        placeId,
        memo,
        position: (last?.position ?? 0) + 1,
      },
      // Reviving a previously removed entry is what makes the soft delete
      // worth having: `removedAt` clears and the member's old memo is still on
      // the row, so re-favouriting restores the note rather than starting
      // blank. A memo of `null` in the input means "not supplied" here — the
      // one-tap save sends none — so it must not overwrite what is stored.
      update: { removedAt: null, ...(memo === null ? {} : { memo }) },
    });
  });
}

/**
 * Un-favourites a place: marks the entry removed, keeping the memo.
 *
 * Scoped through the list's `memberId` in the same `updateMany` rather than
 * read-then-write, so there is no window in which the ownership check has
 * passed and the write has not. `updateMany` also makes a second tap a no-op
 * instead of an error — it matches zero rows and reports zero.
 *
 * Not a `delete`, and the runtime guard would refuse one: the row carries the
 * member's note. See `PlaceListEntry.removedAt` in schema.prisma.
 */
export async function removePlaceFromList(
  memberId: number,
  listSeq: number,
  placeId: number,
): Promise<void> {
  await prisma.placeListEntry.updateMany({
    where: {
      placeId,
      ...liveEntry,
      list: { memberId, memberSeq: listSeq, ...liveList },
    },
    data: { removedAt: new Date() },
  });
}

/**
 * Removes a place from every one of the member's lists — what the filled star
 * does when tapped again.
 *
 * One statement rather than a loop over `listSeqsContaining`, so a place in
 * four lists cannot end up half-removed if the request is cut off midway.
 */
export async function removePlaceEverywhere(
  memberId: number,
  placeId: number,
): Promise<void> {
  await prisma.placeListEntry.updateMany({
    where: { placeId, ...liveEntry, list: { memberId, ...liveList } },
    data: { removedAt: new Date() },
  });
}

/**
 * Edits a list's own fields. Never touches its entries.
 *
 * The default list is locked down to the extent that its purpose requires and
 * no further: it may be recoloured, but not renamed (the one-tap destination
 * has to stay recognisable) and not published (the member never saw a
 * visibility picker for a list that was created implicitly — publishing it
 * would publish places they never chose to share, which the database CHECK
 * also refuses).
 */
export async function updateList(
  memberId: number,
  seq: number,
  input: {
    name?: string;
    color?: string;
    description?: string | null;
    linkUrl?: string | null;
    visibility?: ListVisibility;
  },
): Promise<PlaceList> {
  const list = await requireOwnedList(memberId, seq);

  if (list.isDefault) {
    if (input.name !== undefined && input.name !== list.name) {
      throw new DefaultListLockedError(
        `'${DEFAULT_LIST_NAME}' 리스트의 이름은 바꿀 수 없습니다.`,
      );
    }
    if (
      input.visibility !== undefined &&
      input.visibility !== ListVisibility.PRIVATE
    ) {
      throw new DefaultListLockedError(
        `'${DEFAULT_LIST_NAME}' 리스트는 공개할 수 없습니다.`,
      );
    }
  }

  return prisma.placeList.update({
    where: { id: list.id },
    data: input,
  });
}

/**
 * Throws the whole list away. A state change, not a delete — the entries and
 * the notes on them stay on disk, exactly as a deleted Bookmark keeps its memos.
 *
 * The default list is exempt: it is the destination a one-tap save falls back
 * to, and deleting it would leave the star with nowhere to put a place. The
 * member empties it instead.
 */
export async function deleteList(memberId: number, seq: number): Promise<void> {
  const list = await requireOwnedList(memberId, seq);
  if (list.isDefault) {
    throw new DefaultListLockedError(
      `'${DEFAULT_LIST_NAME}' 리스트는 삭제할 수 없습니다.`,
    );
  }
  await prisma.placeList.update({
    where: { id: list.id },
    data: { deletedAt: new Date() },
  });
}

/**
 * Mints the list's share token if it has none, and returns it.
 *
 * Called when the owner presses 공유 — that press is what turns "일부 공개" from a
 * setting into a reachable page, which is the rule this function exists to
 * implement. Idempotent: a list that has been shared before keeps the token it
 * already handed out, so the link a member sent last month does not quietly
 * stop working the next time they press the button.
 *
 * 32 hex characters from `randomUUID()` — the same source the rest of this app
 * trusts for secrets, and 122 bits of entropy is far past guessing. The dashes
 * are stripped only so the URL reads as one opaque word.
 *
 * Refuses a PRIVATE list rather than minting one silently. A token on a list
 * that cannot be read is not harmful, but issuing one would let the UI show a
 * share sheet for a list the very next request would 404 — and a link that
 * arrives dead is worse than a button that was never offered.
 */
export async function ensureShareToken(
  memberId: number,
  seq: number,
): Promise<string> {
  const list = await requireOwnedList(memberId, seq);
  if (list.visibility === ListVisibility.PRIVATE) {
    throw new ListNotSharableError();
  }
  if (list.shareToken) return list.shareToken;

  const token = randomUUID().replaceAll("-", "");
  // Conditional on the column still being null so two concurrent presses
  // cannot each mint a token and have the second overwrite — which would
  // invalidate the link the first press already put on the clipboard.
  const claimed = await prisma.placeList.updateMany({
    where: { id: list.id, shareToken: null },
    data: { shareToken: token },
  });
  if (claimed.count === 1) return token;

  // Lost the race: the winner's token is the answer.
  const winner = await prisma.placeList.findUnique({
    where: { id: list.id },
    select: { shareToken: true },
  });
  if (!winner?.shareToken) throw new ListNotFoundError();
  return winner.shareToken;
}

/**
 * A shared list addressed by its token, or null.
 *
 * **This is the only read in the app that returns an owned row to someone who
 * does not own it.** Two conditions gate it and both live in the `where`, for
 * the reason ownership predicates always do here — a check made after the read
 * is one a later edit can drop without the query failing:
 *
 *  - the token must match, which is what "the owner actually shared this"
 *    means; and
 *  - `visibility` must still be LINK or PUBLIC, read *at request time*, so
 *    flipping a list back to 비공개 kills every link already handed out.
 */
export async function readListByShareToken(
  token: string,
): Promise<PlaceListDTO | null> {
  const list = await prisma.placeList.findFirst({
    where: {
      shareToken: token,
      ...liveList,
      visibility: { in: [ListVisibility.LINK, ListVisibility.PUBLIC] },
    },
    include: placeListInclude,
  });
  return list ? toPlaceListDTO(list) : null;
}

/**
 * A list at the *discoverable* address `/u/<memberId>/<seq>`, or null.
 *
 * **PUBLIC only, and that asymmetry with {@link readListByShareToken} is the
 * whole of the 일부 공개 rule.** A LINK list is reachable by its token and by
 * nothing else: it must not answer here, because this address is two small
 * sequential integers and answering would let anyone enumerate other members'
 * link-shared lists by counting — which is exactly "a list you never shared
 * being found by someone you did not send it to".
 *
 * Do not widen this back to `{ in: [LINK, PUBLIC] }`. That single edit
 * re-publishes every link-shared list at a guessable URL.
 */
export async function readPublicList(
  memberId: number,
  seq: number,
): Promise<PlaceListDTO | null> {
  const list = await prisma.placeList.findFirst({
    where: {
      memberId,
      memberSeq: seq,
      ...liveList,
      visibility: ListVisibility.PUBLIC,
    },
    include: placeListInclude,
  });
  return list ? toPlaceListDTO(list) : null;
}

/**
 * The lists a member has chosen to publish, for their index at `/u/<id>`.
 *
 * `PUBLIC` only. A `LINK` list is reachable by URL but must never be
 * enumerated here — sharing one list with one person is not a decision to
 * publish a directory of everything ever shared. Collapsing the two visibility
 * values is the mistake this function exists to make hard.
 */
export async function publicListsOf(
  memberId: number,
): Promise<PlaceListSummaryDTO[]> {
  const rows = await prisma.placeList.findMany({
    where: { memberId, ...liveList, visibility: ListVisibility.PUBLIC },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { entries: { where: liveEntry } } } },
  });
  return rows.map(toPlaceListSummaryDTO);
}
