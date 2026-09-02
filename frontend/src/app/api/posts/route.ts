import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { bookmarkInclude, toSavedPostDTO } from "@/lib/serialize";
import { describePost } from "@/lib/ingest/metadata";
import { geocodeCandidates } from "@/lib/ingest/geocode";
import { findPlaceBlogs, type PlaceBlogEntry } from "@/lib/ingest/place-blog";
import { isOwnThumbnailBlob } from "@/lib/post-thumbnail";
import { isOwnAuthorImageBlob } from "@/lib/post-author-image";
import { Platform } from "@/generated/prisma/enums";

// Re-geocoding each confirmed place server-side costs one Naver call apiece,
// though POST /api/ingest has usually just warmed the cache for these same
// names — the lookup is cached, never the decision to re-derive it here.
//
// Only paid on a link nobody has saved yet. A post that already exists is
// bookmarked without any of it: no geocoding, no model, no crawl.
export const maxDuration = 60;

const httpUrl = z.string().refine((value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "http(s) URL만 허용됩니다.");

const BodySchema = z.object({
  post: z.object({
    sourceUrl: httpUrl,
    platform: z.enum(Platform),
    title: z.string().max(500).nullable().optional(),
    caption: z.string().max(20_000).nullable().optional(),
    thumbnail: httpUrl.nullable().optional(),
    // The pre-backup CDN URL, echoed back from the ingest response. Record
    // only: nothing fetches it and nothing decides anything from it.
    //
    // It used to gate the blob delete, and that was a real hole — blob URLs are
    // public and go out in SavedPostDTO, so a caller who could assert "this URL
    // is my backup" could name any blob in our store and have the next save
    // delete it while another row still pointed at it. Do not make this field
    // load-bearing again.
    thumbnailSource: httpUrl.nullable().optional(),
    author: z.string().trim().max(200).nullable().optional(),
    authorImage: httpUrl.nullable().optional(),
    // Record only, exactly like `thumbnailSource` above.
    authorImageSource: httpUrl.nullable().optional(),
  }),
  // Only the name and the area hint are taken from the client; every other
  // field on the shared Place row is re-derived server-side below.
  places: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        hint: z.string().trim().max(200).nullable().optional(),
        memo: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});

export async function GET() {
  try {
    const member = await requireMember();

    const bookmarks = await prisma.bookmark.findMany({
      where: { memberId: member.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: bookmarkInclude,
    });

    // This member's own bookmark list, and the client re-reads it immediately
    // after a save to swap optimistic pins for real rows. Without an explicit
    // directive the response is heuristically cacheable, and a hit there
    // returns the pre-save list — the save succeeds and the map comes back
    // empty. The caller passes `cache: "no-store"` as well; this header is the
    // half that also covers intermediaries, which per-member data must never
    // be shared through.
    return NextResponse.json(
      { posts: bookmarks.map(toSavedPostDTO) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const member = await requireMember();
    const { post, places } = BodySchema.parse(await request.json());

    // Throws UnsupportedUrlError (→400) if the body names a host the ingest
    // path would never have produced, and re-derives the canonical URL rather
    // than trusting the one in the body. That re-derivation matters more than it
    // used to: `sourceUrl` is now the identity of the shared Post row, so an
    // un-normalised variant would give the same post a second row and lose the
    // sharing this split exists for.
    const { sourceUrl } = describePost(post.sourceUrl);

    // Whether anyone has ever saved this link. Read before the transaction
    // because it decides whether we need to geocode at all, and geocoding is
    // seconds of network that must not happen inside a transaction.
    const existing = await prisma.post.findUnique({
      where: { sourceUrl },
      select: { id: true },
    });

    // The expensive half, skipped entirely for a post that already exists —
    // that skip is the reason for the split. Its places, caption and thumbnail
    // were resolved once by whoever saved it first and are shared as they are.
    const resolved = existing
      ? []
      : await geocodeCandidates(
          places.map(({ name, hint }) => ({ name, hint: hint ?? null })),
        );

    const matched = resolved
      .map((place, index) => ({ ...place, memo: places[index].memo ?? null }))
      .filter((place) => place.matched);

    // Blog reviews for the places this request just resolved, fetched outside
    // the transaction for the reason geocoding is: seconds of network must not
    // hold a transaction open.
    //
    // Only ever paid on a link nobody has saved yet — `matched` is empty for an
    // existing post, so this is a no-op there rather than a second condition to
    // keep in sync. That matters because these rows are written once and never
    // refreshed (see the PlaceBlog model): a re-save must not re-query them.
    //
    // Index-aligned with `matched`, and re-keyed onto name/address below rather
    // than carried by position, because ensurePost() re-sorts for lock ordering.
    const blogs = await findPlaceBlogs(
      matched.map(({ name, hint }) => ({ name, hint })),
    );

    // Keyed exactly as ensurePost() keys `captionOrder`, so the two lookups
    // agree. The NUL is load-bearing and every one of these keys must keep it:
    // with a space, {name: "A B", address: "C"} and {name: "A", address: "B C"}
    // collapse to the same key, and one place is handed the other's reviews.
    // (These sites all documented a NUL and used a space until 20260830.)
    const blogsByPlace = new Map(
      matched.map((place, index) => [
        `${place.name}\0${place.address}`,
        blogs[index] ?? [],
      ]),
    );

    // Refusing here keeps a useless row from becoming the canonical one. `Post`
    // is immutable and shared, so whatever this first save stores is what every
    // later member gets — a post created with no places is not just a bad save,
    // it is a permanently bad post that no re-save can repair. The 422 sends the
    // member back to a sheet that stays open.
    //
    // Only checked for a new post: an existing one already has whatever places
    // the first save resolved, and this request geocoded nothing.
    if (!existing && matched.length === 0) {
      return NextResponse.json(
        { error: "지도에서 찾은 장소가 없어 저장하지 못했습니다." },
        { status: 422 },
      );
    }

    // Notes keyed by the **resolved** place name, which is what `Place.name`
    // holds and therefore the only key `memosFor()` can match against.
    //
    // Never by index. For an existing post the shared place list is whatever the
    // first save resolved, in the creator's order — this request's array is a
    // separate list built from this member's own ingest run, and the two differ
    // in length and order. Pairing them positionally attaches a note to the wrong
    // pin.
    //
    // The two paths need different keys, and conflating them silently drops
    // notes:
    //
    // - **New post.** This request geocoded the places, so `matched[i]` carries
    //   both what was searched (`query`, the client's string) and what Naver
    //   returned (`name`, the value stored on the row). The note came in beside
    //   the query, so it has to be re-keyed onto the resolved name — Naver
    //   routinely answers `성수동 대림창고` with a different official name, and
    //   keying on the query would match nothing.
    // - **Existing post.** Nothing was geocoded, so there is no resolved name to
    //   map through; the client's string is all we have and `memosFor()` matches
    //   it against the stored names directly. An unmatched note is dropped, which
    //   is right: a note on the wrong pin is worse than a missing one.
    //
    // Almost always empty in practice — no screen writes a memo today
    // (`SavedPlaceDTO.memo` is render-only, and the existing rows date from a
    // version that had an editor). The field stays because the column is real and
    // a client may legitimately send one; dropping it would discard data rather
    // than store it.
    const memoByName = new Map(
      existing
        ? places
            .filter((place) => place.memo)
            .map((place) => [place.name, place.memo ?? null] as const)
        : matched
            .filter((place) => place.memo)
            .map((place) => [place.name, place.memo ?? null] as const),
    );

    // Retried on a unique violation, which is the whole concurrency story of
    // this route. Two writes race here and both are ordinary, not abusive:
    //
    // - `Post_sourceUrl_key` — two members saving the same brand-new link. Both
    //   read "new" outside the transaction and both try to create the post.
    // - `Bookmark_memberId_memberSeq_key` — one member saving two links at once
    //   (two tabs). `memberSeq` is MAX+1 rather than a sequence because it must
    //   be per-member, so the read and the insert are not atomic together and
    //   this index is the arbiter.
    //
    // Both are self-healing on a second attempt: the post now exists, and MAX+1
    // now returns a free number. Without the retry the loser answered a generic
    // 500 — indistinguishable from a real fault — and on the first-save path it
    // also threw away seconds of Naver geocoding. `matched` is computed above
    // and reused, so a retry costs one more transaction, not another round of
    // lookups.
    const saved = await withUniqueRetry(() => prisma.$transaction(async (tx) => {
      // Resolved inside the transaction rather than reusing `existing.id`. The
      // read above decides only whether to *geocode*; by the time we get here
      // another request may have created this post, and two members saving the
      // same brand-new link within a few seconds is exactly the workload this
      // split was built for. Left as a bare create, the loser violated
      // `Post_sourceUrl_key` and its save answered 500 for something that should
      // simply have shared the winner's row.
      const postId = await ensurePost(tx, {
        post,
        sourceUrl,
        matched,
        blogsByPlace,
      });

      // findUnique on a real unique again: [memberId, postId] holds across all
      // rows, not just live ones, because a re-save now revives the row it
      // finds. That revival is the whole point — it brings back the memos the
      // member wrote and keeps the /links/<seq> URL they may have bookmarked.
      const previous = await tx.bookmark.findUnique({
        where: { memberId_postId: { memberId: member.id, postId } },
        select: { id: true, deletedAt: true },
      });

      const bookmark = previous
        ? await tx.bookmark.update({
            where: { id: previous.id },
            // Clearing deletedAt is the revive. `memberSeq` is deliberately
            // untouched: it is the URL this bookmark has always had.
            data: { deletedAt: null },
          })
        : await tx.bookmark.create({
            data: {
              memberId: member.id,
              postId,
              memberSeq: await nextMemberSeq(tx, member.id),
            },
          });

      // Written after the row exists, and only for places the member annotated.
      // upsert rather than a wipe-and-insert: nothing here may remove rows (see
      // prisma-guard.ts — BookmarkMemo is not on the allowlist), and a re-save
      // should update a note rather than drop the ones it does not mention.
      for (const { placeId, memo } of await memosFor(tx, postId, memoByName)) {
        await tx.bookmarkMemo.upsert({
          where: { bookmarkId_placeId: { bookmarkId: bookmark.id, placeId } },
          create: { bookmarkId: bookmark.id, placeId, memo },
          update: { memo },
        });
      }

      return tx.bookmark.findUniqueOrThrow({
        where: { id: bookmark.id },
        include: bookmarkInclude,
      });
    }));

    return NextResponse.json(
      {
        id: saved.id,
        seq: saved.memberSeq,
        post: toSavedPostDTO(saved),
        // Whether this request geocoded anything, so the client knows what its
        // own candidate count is comparable to. For a post that already existed
        // the row carries the *shared* place list and this request resolved
        // nothing — comparing the two numbers would report lookup failures for a
        // round that never ran.
        reusedPost: existing !== null,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Runs `attempt` again if it lost a unique-constraint race.
 *
 * Bounded at three tries, and the bound matters: a retry only helps when the
 * conflict is transient — someone else won a create, or took the number this
 * request had computed. A conflict that survives three attempts is not a race
 * but a real constraint problem, and looping on it would turn a 500 into a hung
 * request holding a database connection.
 *
 * Deliberately narrow. Only P2002 is retried; every other error propagates
 * untouched to `toErrorResponse()`, because retrying an unknown failure is how a
 * one-off becomes three identical writes.
 */
async function withUniqueRetry<T>(attempt: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let tries = 0; tries < 3; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === UNIQUE_VIOLATION
        )
      ) {
        throw error;
      }
      last = error;
    }
  }
  throw last;
}

/**
 * The member's next bookmark number.
 *
 * MAX+1 rather than a sequence, because Postgres sequences are global and this
 * number is per member — a global counter in the URL would publish how many
 * links the whole service holds. The read and the insert are not atomic
 * together, so two concurrent saves can compute the same value; the unique on
 * [memberId, memberSeq] is what decides that race, and the loser's transaction
 * fails rather than silently taking another bookmark's URL.
 *
 * Counts soft-deleted rows too (no `deletedAt` filter): a deleted bookmark keeps
 * its number, so skipping them would hand a new bookmark a number that is
 * already taken and fail the unique every time.
 */
async function nextMemberSeq(tx: Tx, memberId: number): Promise<number> {
  const highest = await tx.bookmark.aggregate({
    where: { memberId },
    _max: { memberSeq: true },
  });
  return (highest._max?.memberSeq ?? 0) + 1;
}

/**
 * The shared Post for this `sourceUrl`, created only if nobody has saved it yet.
 *
 * Returns an existing row's id untouched. Post is immutable after creation: it
 * is read by members who have no relationship to whoever saved it first, so
 * letting a later save rewrite it would let one member change what another sees.
 *
 * The create is guarded by the unique on `sourceUrl` rather than by the earlier
 * read, because that read is outside this transaction. Concurrent first saves of
 * one link both see "new" and both arrive here; the loser catches its own unique
 * violation and re-reads, so both end up sharing the winner's post instead of one
 * of them failing.
 */
async function ensurePost(
  tx: Tx,
  {
    post,
    sourceUrl,
    matched,
    blogsByPlace,
  }: {
    post: z.infer<typeof BodySchema>["post"];
    sourceUrl: string;
    matched: Array<{
      name: string;
      address: string;
      lat: number;
      lng: number;
      category: string | null;
    }>;
    /** Reviews per place, keyed `"<name> <address>"`. Empty for an existing post. */
    blogsByPlace: Map<string, PlaceBlogEntry[]>;
  },
): Promise<number> {
  const already = await tx.post.findUnique({
    where: { sourceUrl },
    select: { id: true },
  });
  if (already) return already.id;

  // Recorded only alongside a thumbnail that really is one of our blobs, so the
  // column never claims a platform CDN URL was backed up. Purely descriptive.
  const thumbnailSource = isOwnThumbnailBlob(post.thumbnail ?? null)
    ? (post.thumbnailSource ?? null)
    : null;

  const authorId = post.author
    ? await upsertAuthor(tx, {
        platform: post.platform,
        handle: post.author,
        image: post.authorImage ?? null,
        imageSource: isOwnAuthorImageBlob(post.authorImage ?? null)
          ? (post.authorImageSource ?? null)
          : null,
      })
    : null;

  const created = await tx.post.create({
    data: {
      sourceUrl,
      platform: post.platform,
      title: post.title ?? null,
      caption: post.caption ?? null,
      thumbnail: post.thumbnail ?? null,
      thumbnailSource,
      authorId,
    },
    select: { id: true },
  });

  // The order the caption named them in, captured before the sort below
  // reorders the writes. `/links` numbers these rows as a route, so the
  // creator's sequence is what has to survive: reading the rows back in
  // insertion order would hand the user the alphabetical order instead.
  //
  // Keyed with the same NUL separator the sort uses, so a name containing
  // whitespace cannot collide with the next field.
  const captionOrder = new Map(
    matched.map((place, index) => [`${place.name}\0${place.address}`, index]),
  );

  // Sorting makes lock acquisition order deterministic across concurrent
  // transactions touching an overlapping set of shared Place rows. It
  // deliberately does not decide the order the user sees — `position` does.
  const ordered = [...matched].sort((a, b) =>
    `${a.name}\0${a.address}`.localeCompare(`${b.name}\0${b.address}`),
  );

  const linked = new Set<number>();
  for (const place of ordered) {
    const stored = await tx.place.upsert({
      where: { name_address: { name: place.name, address: place.address } },
      create: {
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        category: place.category,
        // Nested in `create` and deliberately absent from `update`: these rows
        // are read by every member who saved any post naming this place, so a
        // later save replacing them would rewrite what everyone else sees. Same
        // argument as the empty `update` below — see the PlaceBlog model.
        blogs: {
          create: (
            blogsByPlace.get(`${place.name}\0${place.address}`) ?? []
          ).map((blog, index) => ({ ...blog, position: index })),
        },
      },
      // An existing row is shared with other members' posts; leave it alone.
      update: {},
    });

    // Two distinct queries can resolve to one Naver record, and PostPlace is
    // keyed on [postId, placeId].
    if (linked.has(stored.id)) continue;
    linked.add(stored.id);

    await tx.postPlace.create({
      data: {
        postId: created.id,
        placeId: stored.id,
        // From the queried name/address rather than the loop index: two
        // distinct queries can dedupe to one Place (the `linked` guard above),
        // which would leave gaps in the sequence.
        position: captionOrder.get(`${place.name}\0${place.address}`) ?? 0,
      },
    });
  }

  return created.id;
}

/**
 * The author row for this handle on this platform, created if new.
 *
 * `update` refreshes the avatar but never the handle: [platform, handle] is the
 * identity, so a different handle is a different author. The avatar is refreshed
 * because Instagram's expire — a handle whose picture changed converges as its
 * posts are saved.
 *
 * Only reached while creating a Post, i.e. on the first save of a link. A
 * re-save of an existing post does not come through here, so it cannot touch an
 * author another member's posts also point at.
 */
async function upsertAuthor(
  tx: Tx,
  author: {
    platform: Platform;
    handle: string;
    image: string | null;
    imageSource: string | null;
  },
): Promise<number> {
  const row = await tx.author.upsert({
    where: {
      platform_handle: { platform: author.platform, handle: author.handle },
    },
    create: author,
    // Only when this ingest actually produced one: a re-ingest while Instagram
    // is blocking us arrives with `image: null`, and overwriting would drop a
    // perfectly good avatar for a broken one.
    update: author.image
      ? { image: author.image, imageSource: author.imageSource }
      : {},
    select: { id: true },
  });
  return row.id;
}

/**
 * Pairs the member's notes with the shared post's places, by name.
 *
 * Not by index. For an existing post the place list is whatever the first save
 * resolved, in the creator's order — this request's `places` array is a separate
 * list the client built from its own ingest run, and the two can differ in
 * length and order. Matching on the resolved place name is what makes a second
 * member's memos land on the right pins.
 *
 * A note whose name matches nothing is dropped rather than stored against an
 * arbitrary place: a memo on the wrong pin is worse than a missing one.
 */
async function memosFor(
  tx: Tx,
  postId: number,
  memoByName: Map<string, string | null>,
): Promise<Array<{ placeId: number; memo: string | null }>> {
  if (memoByName.size === 0) return [];

  const links = await tx.postPlace.findMany({
    where: { postId },
    select: { placeId: true, place: { select: { name: true } } },
  });

  return links
    .filter((link) => memoByName.has(link.place.name))
    .map((link) => ({
      placeId: link.placeId,
      memo: memoByName.get(link.place.name) ?? null,
    }));
}
