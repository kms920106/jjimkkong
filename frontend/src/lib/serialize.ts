import type { AuthorDTO, SavedPostDTO } from "@/lib/types";
import type {
  Author,
  Bookmark,
  BookmarkMemo,
  Place,
  Post,
  PostPlace,
} from "@/generated/prisma/client";

type BookmarkWithPost = Bookmark & {
  post: Post & {
    author: Author | null;
    places: Array<PostPlace & { place: Place }>;
  };
  memos: BookmarkMemo[];
};

/**
 * Shared by the server-rendered pages and GET /api/posts so both return the
 * same shape — the client swaps one for the other after a save.
 *
 * The join spans both halves of the split: everything the platform published
 * comes off `post` and is shared with every other member who saved the same
 * link, while `seq`, `deletedAt` and the memos come off the bookmark row and
 * belong to this member alone.
 */
export function toSavedPostDTO(bookmark: BookmarkWithPost): SavedPostDTO {
  const { post } = bookmark;

  // Keyed lookup rather than a positional zip: memos exist only for places the
  // member actually annotated, so the two arrays have different lengths and
  // pairing them by index would attach notes to the wrong places.
  const memoByPlace = new Map(
    bookmark.memos.map((memo) => [memo.placeId, memo.memo]),
  );

  return {
    id: bookmark.id,
    postId: post.id,
    seq: bookmark.memberSeq,
    sourceUrl: post.sourceUrl,
    platform: post.platform,
    title: post.title,
    thumbnail: post.thumbnail,
    author: toAuthorDTO(post.author),
    createdAt: bookmark.createdAt.toISOString(),
    places: post.places.map(({ place }) => ({
      id: place.id,
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      category: place.category,
      naverLink: place.naverLink,
      memo: memoByPlace.get(place.id) ?? null,
    })),
  };
}

/**
 * Null in, null out: a post whose platform named no author, which is the normal
 * state for the map platforms and for an Instagram post ingested while the embed
 * page was blocked.
 */
export function toAuthorDTO(author: Author | null): AuthorDTO | null {
  if (!author) return null;
  return { id: author.id, handle: author.handle, image: author.image };
}

/**
 * The include clause every caller of toSavedPostDTO must use for it to typecheck.
 *
 * `orderBy: position` is not cosmetic: `/links` numbers a post's places as a
 * route, and without it the rows come back in whatever order the planner picks
 * — typically the composite primary key, i.e. by random cuid. The write path
 * sorts by name for lock ordering, so insertion order is not the caption's
 * order either.
 *
 * `position` now sits on PostPlace rather than per-bookmark, because the order
 * is the *creator's* reading of their own caption and is therefore the same for
 * everyone who saved the post.
 */
export const bookmarkInclude = {
  post: {
    include: {
      author: true,
      places: { include: { place: true }, orderBy: { position: "asc" } },
    },
  },
  memos: true,
} as const;
