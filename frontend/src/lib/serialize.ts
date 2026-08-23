import type { SavedPostDTO } from "@/lib/types";
import type { Place, SavedPost, SavedPostPlace } from "@/generated/prisma/client";

type SavedPostWithPlaces = SavedPost & {
  places: Array<SavedPostPlace & { place: Place }>;
};

/**
 * Shared by the server-rendered home page and GET /api/posts so both return
 * the same shape — the client swaps one for the other after a save.
 */
export function toSavedPostDTO(post: SavedPostWithPlaces): SavedPostDTO {
  return {
    id: post.id,
    sourceUrl: post.sourceUrl,
    platform: post.platform,
    title: post.title,
    thumbnail: post.thumbnail,
    author: post.author,
    authorImage: post.authorImage,
    createdAt: post.createdAt.toISOString(),
    places: post.places.map(({ place, memo }) => ({
      id: place.id,
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      category: place.category,
      naverLink: place.naverLink,
      memo,
    })),
  };
}

/**
 * The include clause both callers must use for toSavedPostDTO to typecheck.
 *
 * `orderBy: position` is not cosmetic: `/links` numbers a post's places as a
 * route, and without it the rows come back in whatever order the planner picks
 * — typically the composite primary key, i.e. by random cuid. The write path
 * sorts by name for lock ordering, so insertion order is not the caption's
 * order either.
 */
export const savedPostInclude = {
  places: { include: { place: true }, orderBy: { position: "asc" } },
} as const;
