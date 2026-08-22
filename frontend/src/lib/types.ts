import type { MapProvider, Platform } from "@/generated/prisma/enums";

/** Shape returned by GET /api/posts. */
export type SavedPlaceDTO = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: string | null;
  naverLink: string | null;
  memo: string | null;
};

/**
 * Shape returned by GET /api/places/[id]/sources — every saved post that
 * names a place, across every user, deduped by sourceUrl. Not scoped to the
 * caller: the place pin is already shared across users, so the sheet under
 * it is too. Deliberately missing `createdAt`/`id`-for-the-post beyond what
 * PlaceSheet renders, since this is read-only and never round-trips to a
 * mutation endpoint.
 */
export type PlaceSourceDTO = {
  postId: string;
  sourceUrl: string;
  platform: Platform;
  title: string | null;
  thumbnail: string | null;
  author: string | null;
  memo: string | null;
};

export type SavedPostDTO = {
  id: string;
  sourceUrl: string;
  platform: Platform;
  title: string | null;
  thumbnail: string | null;
  author: string | null;
  createdAt: string;
  places: SavedPlaceDTO[];
};

/** Shape returned by POST /api/ingest; consumed immediately by the save step. */
export type IngestedPost = {
  sourceUrl: string;
  platform: Platform;
  title: string | null;
  caption: string | null;
  thumbnail: string | null;
  author: string | null;
};

export type IngestCandidate = {
  /** The name the model extracted; sent back on save to re-run the lookup. */
  query: string;
  hint: string | null;
  matched: boolean;
  /** The lookup failed rather than finding nothing — retryable. */
  lookupFailed: boolean;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: string | null;
  naverLink: string | null;
};

export type IngestResponse = {
  post: IngestedPost;
  candidates: IngestCandidate[];
  needsManualCaption: boolean;
};

/** The subset of UserProfile the client shell renders. */
export type ProfileDTO = {
  nickname: string | null;
  email: string | null;
  /**
   * Already masked (`010-****-5678`) by the server, and null when the account
   * has no verified number or its stored value could not be decrypted.
   *
   * Masked before it leaves the server rather than in the component: the full
   * number has no use in the browser, so it should not be in the payload at
   * all. Never send the decrypted number to the client.
   */
  phoneMasked: string | null;
  mapProvider: MapProvider;
  /**
   * Whether a password is set, not the password or its hash — the verifier must
   * never leave the server. Only used to word the settings row ("설정" for a first
   * password, "변경" for a replacement); both paths do exactly the same thing.
   */
  hasPassword: boolean;
};

/**
 * What the drawer shows above the menu. The email's local part stands in
 * until the user sets a nickname, so the profile row is never blank.
 */
export function displayName(profile: {
  nickname: string | null;
  email: string | null;
}): string {
  if (profile.nickname) return profile.nickname;
  const local = profile.email?.split("@")[0];
  return local && local.length > 0 ? local : "찜꽁 사용자";
}

export type { MapProvider, Platform };
