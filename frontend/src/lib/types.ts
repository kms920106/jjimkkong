import type { MapProvider, Platform } from "@/generated/prisma/enums";

/** Shape returned by GET /api/posts. */
/**
 * One Naver blog review of a place, already cleaned for rendering — the search
 * response marks matches with `<b>` and escapes quotes, and both are stripped
 * before the row is written.
 *
 * Frozen at whatever the place's first save found; see the PlaceBlog model for
 * why there is no refresh.
 */
export type PlaceBlogDTO = {
  title: string;
  link: string;
  description: string;
  bloggername: string;
  /** Naver's "YYYYMMDD" string, formatted for display at the render site. */
  postdate: string;
};

export type SavedPlaceDTO = {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: string | null;
  naverLink: string | null;
  memo: string | null;
  /**
   * Shared, like everything else on the place row — not scoped to the member
   * reading it. Empty when the lookup found nothing or was unavailable at the
   * time of the first save.
   */
  blogs: PlaceBlogDTO[];
};

/**
 * One creator, as the client needs them: an id to link to and a handle to show.
 *
 * `id` is what `/author/<id>` addresses. The handle stays in the payload because
 * that is what the UI renders — it is a display value here, not a key.
 */
export type AuthorDTO = {
  id: number;
  handle: string;
  /**
   * Already a renderable URL — our own blob for Instagram, whose avatar URLs are
   * signed and expire, and null for platforms that gave us none. `imageSource`
   * is deliberately not exposed: nothing in the browser needs the pre-backup
   * URL, and it is the one that goes stale.
   */
  image: string | null;
};

/**
 * Shape returned by GET /api/places/[id]/sources — every post that names a
 * place, deduped by sourceUrl. Not scoped to the caller: the place pin is
 * already shared, so the sheet under it is too.
 *
 * `postId` is the shared Post id, and it is deliberately not a link target. A
 * member's own bookmark is addressed by their per-member sequence, which this
 * route cannot use because it serves rows across every member — publishing
 * another member's sequence here would leak how much they have saved. The id is
 * kept only as the dedupe key.
 *
 * `memo` is absent for the same reason it used to be present and now cannot be:
 * a note belongs to one member's bookmark, and this listing is not scoped to
 * one member, so there is no single note to show.
 */
export type PlaceSourceDTO = {
  postId: number;
  sourceUrl: string;
  platform: Platform;
  title: string | null;
  thumbnail: string | null;
  author: AuthorDTO | null;
};

export type SavedPostDTO = {
  /** The bookmark row's own id, used by the mutation endpoints. */
  id: number;
  /**
   * The shared post this bookmarks. Never a link target — `/links/<seq>` is what
   * addresses a bookmark, and publishing a global id would leak how many links
   * the service holds. Carried because the place sheet merges the member's own
   * sources with every other member's, and both halves have to identify a post
   * by the same key for the dedupe to work.
   */
  postId: number;
  /**
   * This bookmark's number within the member's collection, and what `/links/1`
   * addresses. Per-member rather than global so the URL never publishes how many
   * links the service holds — see the Bookmark model.
   */
  seq: number;
  sourceUrl: string;
  platform: Platform;
  title: string | null;
  /**
   * Always a URL that can be rendered as-is: our own blob for Instagram, whose
   * CDN URLs are signed and expire, and the platform CDN for everyone else.
   * `thumbnailSource` is deliberately not exposed — nothing in the browser
   * needs the pre-backup URL, and it is the one that goes stale.
   */
  thumbnail: string | null;
  author: AuthorDTO | null;
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
  /**
   * Round-tripped to POST /api/posts so the row records which thumbnails are
   * backed-up blobs of ours — that is what lets a later save or delete know
   * there is a blob to clean up.
   */
  thumbnailSource: string | null;
  author: string | null;
  authorImage: string | null;
  /**
   * Round-tripped for the same reason `thumbnailSource` is: it is what lets the
   * saved row record that its avatar is a blob of ours rather than a platform
   * URL that will expire.
   */
  authorImageSource: string | null;
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

/**
 * The stage POST /api/ingest is currently working on.
 *
 * Reported because the whole pipeline is one button press but takes tens of
 * seconds on a long Instagram caption — metadata fetch, then the model, then
 * one Naver lookup per place. A single "읽는 중…" for all of it reads as a
 * hang, and the user's only recourse is to press the button again.
 *
 * `geocoding` carries counts because it is the one stage whose length depends
 * on the post rather than the network: a date-course reel names five or six
 * places and the user can watch them resolve.
 */
export type IngestStage =
  | { stage: "fetching" }
  | { stage: "extracting" }
  | { stage: "geocoding"; done: number; total: number };

/**
 * One line of the NDJSON body POST /api/ingest streams.
 *
 * `error` exists because a stream commits its status line with the first byte,
 * so a failure after that point cannot be a 4xx. The message is the same one
 * `describeError()` would have put in a non-streamed body, and `status` is
 * carried so the client can still tell a 429 from a 500 if it needs to.
 */
export type IngestEvent =
  | ({ type: "progress" } & IngestStage)
  | { type: "result"; result: IngestResponse }
  | { type: "error"; status: number; error: string };

/** The subset of Member the client shell renders. */
export type ProfileDTO = {
  nickname: string | null;
  /** Free-text line under the nickname; null when never set. */
  statusMessage: string | null;
  /**
   * Absolute Vercel Blob URL of the profile picture, or null for the
   * initial-letter fallback. Served straight off the blob CDN.
   */
  imageUrl: string | null;
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
