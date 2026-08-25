import { parse, type HTMLElement, TextNode } from "node-html-parser";
import { Platform } from "@/generated/prisma/enums";

export type PostMetadata = {
  sourceUrl: string;
  platform: Platform;
  title: string | null;
  caption: string | null;
  /**
   * The URL to render. For Instagram this is a blob URL once
   * {@link import("@/lib/post-thumbnail").backupThumbnail} has run, because the
   * platform URL it started as expires; for every other platform it stays the
   * platform CDN URL.
   */
  thumbnail: string | null;
  /**
   * The original CDN URL, set only where `thumbnail` was replaced by a backup.
   * Non-null therefore means "this thumbnail was backed up" — a more honest
   * predicate than string-matching the blob host, and the condition the
   * backfill script uses to stay idempotent.
   */
  thumbnailSource: string | null;
  author: string | null;
  /**
   * The author's avatar, as a URL to render. Instagram serves these from the
   * same signed CDN as post images, so this becomes a blob URL once
   * {@link import("@/lib/post-author-image").backupAuthorImage} has run.
   *
   * Null for every platform but Instagram: YouTube's oEmbed and Data API
   * responses carry a channel title but no avatar, and the map platforms have
   * no author at all.
   */
  authorImage: string | null;
  /**
   * The original CDN URL, set only where `authorImage` was replaced by a
   * backup — the same "this was backed up" predicate `thumbnailSource` is.
   */
  authorImageSource: string | null;
  /** True when the caption could not be fetched and the user must paste it. */
  needsManualCaption: boolean;
  /**
   * Set only for map links, which name one place outright. The ingest route
   * geocodes this directly instead of sending a caption through the model —
   * there is no prose to read, and the page already told us the answer.
   */
  place?: { name: string; hint: string | null };
};

export class UnsupportedUrlError extends Error {
  constructor(url: string) {
    super(`지원하지 않는 링크입니다: ${url}`);
    this.name = "UnsupportedUrlError";
  }
}

/**
 * Instagram serves a logged-out shell — 200 OK with no caption and no og:title
 * — to browser user agents. The crawler UA it whitelists for link previews is
 * the only client that gets real content back.
 */
const CRAWLER_UA = "facebookexternalhit/1.1";

const FETCH_TIMEOUT_MS = 8_000;

export function classifyUrl(raw: string): {
  platform: Platform;
  url: URL;
  youtubeId?: string;
  mapPlace?: MapPlaceRef;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsupportedUrlError(raw);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsupportedUrlError(raw);
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    // Must look like a video id — the short domain also serves channel
    // handles (`youtu.be/@name`), which would canonicalize to a dead watch URL.
    const id = url.pathname.slice(1).split("/")[0];
    if (/^[\w-]{11}$/.test(id)) {
      return { platform: Platform.YOUTUBE, url, youtubeId: id };
    }
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    const watchId = url.searchParams.get("v");
    if (watchId) return { platform: Platform.YOUTUBE, url, youtubeId: watchId };

    const shortsMatch = url.pathname.match(/^\/shorts\/([\w-]+)/);
    if (shortsMatch) {
      return { platform: Platform.YOUTUBE, url, youtubeId: shortsMatch[1] };
    }
  }

  if (host === "instagram.com") {
    if (/^\/(p|reel|reels|tv)\/[\w-]+/.test(url.pathname)) {
      return { platform: Platform.INSTAGRAM, url };
    }
  }

  const mapPlace = classifyMapPlace(host, url);
  if (mapPlace) {
    return { platform: platformOf(mapPlace), url, mapPlace };
  }

  throw new UnsupportedUrlError(raw);
}

/**
 * A short link is classified before its vendor page is known, but the host it
 * was handed out under already names the vendor — so the platform never has to
 * wait for the redirect to resolve.
 */
function platformOf(ref: MapPlaceRef): Platform {
  return ref.vendor === "kakao" ? Platform.KAKAO : Platform.NAVER;
}

/**
 * A map link *is* a place, unlike a post that mentions several. Both Naver and
 * Kakao key their place pages on a numeric id, so recognising the id is the
 * whole classification — the name is looked up from it later.
 *
 * Share sheets hand out short links (naver.me, kko.to) that carry no id until
 * they are followed, so those are marked for a redirect resolve at fetch time
 * rather than being parsed here, where there is no network.
 */
export type MapPlaceRef =
  | { vendor: "naver" | "kakao"; id: string }
  | { vendor: "naver" | "kakao"; shortUrl: string };

function classifyMapPlace(host: string, url: URL): MapPlaceRef | undefined {
  if (host === "naver.me") return { vendor: "naver", shortUrl: url.toString() };
  if (host === "kko.to" || host === "kko.kakao.com") {
    return { vendor: "kakao", shortUrl: url.toString() };
  }

  if (host === "map.naver.com" || host === "m.place.naver.com") {
    // /p/entry/place/<id>, /p/search/…/place/<id> and the bare
    // m.place.naver.com/<type>/<id>/home all end on the same numeric id.
    const id = url.pathname.match(/\/place\/(\d+)|^\/[a-z]+\/(\d+)/);
    const found = id?.[1] ?? id?.[2];
    if (found) return { vendor: "naver", id: found };
  }

  if (host === "place.map.kakao.com" || host === "m.place.map.kakao.com") {
    const found = url.pathname.match(/^\/(\d+)/)?.[1];
    if (found) return { vendor: "kakao", id: found };
  }

  if (host === "map.kakao.com" || host === "applink.map.kakao.com") {
    // The share sheet's applink form carries the id in the query string.
    const found = url.searchParams.get("id") ?? url.searchParams.get("itemId");
    if (found && /^\d+$/.test(found)) return { vendor: "kakao", id: found };
  }

  return undefined;
}

/** Strips tracking params so the same post always yields one stored row. */
function canonicalize(
  platform: Platform,
  url: URL,
  youtubeId?: string,
  mapPlace?: MapPlaceRef,
): string {
  if (platform === Platform.YOUTUBE && youtubeId) {
    return `https://www.youtube.com/watch?v=${youtubeId}`;
  }
  if (mapPlace && "id" in mapPlace) {
    // The share sheet, the mobile site and the desktop map all point at one
    // place through different paths; collapsing them onto the canonical entry
    // keeps `Post.sourceUrl` — the key every member's save of this link resolves
    // to — stable.
    return mapPlace.vendor === "naver"
      ? `https://map.naver.com/p/entry/place/${mapPlace.id}`
      : `https://place.map.kakao.com/${mapPlace.id}`;
  }
  if (platform === Platform.INSTAGRAM) {
    const [, kind, shortcode] = url.pathname.split("/");
    // The same post is reachable as /reel/, /reels/, /tv/ and /p/. Collapsing
    // them keeps `Post.sourceUrl` stable and stores a permalink that actually
    // resolves — /reels/<code>/ 404s.
    //
    // This matters more than it used to: that column is now the identity of a
    // globally shared row, so a variant that escapes normalisation does not just
    // duplicate one member's save — it makes the next member re-run the whole
    // crawl + model + geocode pipeline for a post we already have.
    const canonicalKind = kind === "reels" ? "reel" : kind === "tv" ? "p" : kind;
    return `https://www.instagram.com/${canonicalKind}/${shortcode}/`;
  }
  return url.toString();
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
}

async function fetchYouTube(
  sourceUrl: string,
  videoId: string,
): Promise<PostMetadata> {
  const base: PostMetadata = {
    sourceUrl,
    platform: Platform.YOUTUBE,
    title: null,
    caption: null,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    // YouTube thumbnail URLs are unsigned and never expire, so nothing is
    // backed up and this stays null.
    thumbnailSource: null,
    author: null,
    authorImage: null,
    authorImageSource: null,
    needsManualCaption: false,
  };

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    // The Data API is the only source for the full description, which is where
    // creators actually list places. oEmbed returns title/author only.
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
    endpoint.searchParams.set("part", "snippet");
    endpoint.searchParams.set("id", videoId);
    endpoint.searchParams.set("key", apiKey);

    const res = await fetchWithTimeout(endpoint.toString());
    if (res.ok) {
      const body = (await res.json()) as {
        items?: Array<{
          snippet?: {
            title?: string;
            description?: string;
            channelTitle?: string;
            thumbnails?: Record<string, { url?: string }>;
          };
        }>;
      };
      const snippet = body.items?.[0]?.snippet;
      if (snippet) {
        return {
          ...base,
          title: snippet.title ?? null,
          caption: snippet.description ?? null,
          author: snippet.channelTitle ?? null,
          // The Data API's snippet has no channel avatar; fetching one
          // would be a second quota-costing call to channels.list for a
          // picture, so YouTube posts render the initial fallback.
          authorImage: null,
          authorImageSource: null,
          thumbnail:
            snippet.thumbnails?.maxres?.url ??
            snippet.thumbnails?.high?.url ??
            base.thumbnail,
          // An empty description is not a caption. Inheriting `false` from
          // `base` would send the title alone to the model — titles almost
          // never name a place — and end at the dead-end "no places" toast.
          // `true` routes to CaptionPrompt, which the user can recover from,
          // and matches what the oEmbed branch below already decides.
          needsManualCaption: !snippet.description?.trim(),
        };
      }
      // 200 with no items: private, deleted, or region-blocked. The oEmbed
      // fallback below fails too, so the user ends at manual caption — this
      // line is the only place that says why.
      console.warn(
        `[ingest:youtube] data api returned no items videoId=${videoId}`,
      );
    } else {
      // Falling through to oEmbed loses the description, which is where
      // creators list places. Without this line an invalid key looks exactly
      // like a video that has no description: `if (apiKey)` checks presence
      // only, so a placeholder enters this branch, fails, and falls back
      // silently. Status alone is enough to tell those apart (400 = bad key,
      // 403 = quota/referrer, 404 = no such video); the body is not logged
      // because the request URL carries the key.
      console.warn(
        `[ingest:youtube] data api failed status=${res.status} videoId=${videoId}`,
      );
    }
  }

  // Keyless fallback: title + author, no description.
  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;
  const res = await fetchWithTimeout(oembed);
  if (!res.ok) {
    return { ...base, needsManualCaption: true };
  }

  const body = (await res.json()) as {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
  };

  return {
    ...base,
    title: body.title ?? null,
    author: body.author_name ?? null,
    // oEmbed returns author_name and author_url, never a picture.
    authorImage: null,
    authorImageSource: null,
    thumbnail: body.thumbnail_url ?? base.thumbnail,
    // oEmbed carries no description, so there is nothing for the model to read.
    needsManualCaption: true,
  };
}

/**
 * Why a step gave up. Distinguishing these matters because they need different
 * responses: a transport fault is worth retrying, a block or a removed post is
 * not, and a shape change means our selectors need updating.
 */
type FailureReason =
  | "timeout"
  | "network"
  | "http_error"
  // 200 OK, but the body is Instagram's "link may be broken" shell. Served both
  // for genuinely removed posts and — as of 2026 — for live posts fetched with
  // the crawler UA, so it signals "no embed available", not "post is gone".
  | "embed_broken_media_shell"
  | "login_wall"
  // Real markup, but `.Caption` is absent or empty: either a layout change or a
  // post that genuinely carries no caption text.
  | "caption_node_missing"
  // og:description was present but did not carry the engagement envelope, so no
  // caption could be lifted out of it. Distinct from the embed-markup case
  // above: a log grouped by reason must not conflate the two.
  | "og_caption_unparsed"
  | "no_og_tags"
  // The body arrived but could not be read or parsed. Not retryable.
  | "malformed_response"
  | "unknown";

/**
 * Facts about the response that make a failure actionable after the fact —
 * without them, every distinct cause reads as the same one-line warning.
 */
type FailureContext = {
  status?: number;
  /** UTF-16 code units, not bytes — a Korean-heavy body transfers ~3x larger. */
  chars?: number;
  /** The markup landmark that classified the body. */
  marker?: string;
  errorName?: string;
  errorMessage?: string;
  [key: string]: string | number | boolean | undefined;
};

function classifyThrown(cause: unknown): {
  reason: FailureReason;
  context: FailureContext;
} {
  if (cause instanceof DOMException && cause.name === "TimeoutError") {
    return {
      reason: "timeout",
      context: { errorName: cause.name, timeoutMs: FETCH_TIMEOUT_MS },
    };
  }
  if (cause instanceof Error) {
    // The try blocks span the body read and the HTML parse too, so not every
    // throw is a transport fault. `fetch` surfaces those as TypeError; a parser
    // or truncated-body throw is something else and must not be labelled
    // retryable, or a permanent failure gets retried forever.
    const isTransport = cause.name === "TypeError";
    return {
      reason: isTransport ? "network" : "malformed_response",
      context: { errorName: cause.name, errorMessage: cause.message },
    };
  }
  return { reason: "unknown", context: { errorMessage: String(cause) } };
}

function logInstagramFailure(
  step: string,
  sourceUrl: string,
  reason: FailureReason,
  context: FailureContext = {},
) {
  const details = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.warn(
    `[ingest:instagram] ${step} unavailable reason=${reason}` +
      `${details ? ` ${details}` : ""} url=${sourceUrl}`,
  );
}

/**
 * Reads the caption out of an embed page. The markup is
 * `<a class="CaptionUsername">handle</a>` followed by the caption body and a
 * trailing `View all N comments` link, so both ends are trimmed and the line
 * breaks are preserved — captions list the place and its address on their own
 * lines, and flattening them costs the extractor that structure.
 */
function parseEmbedCaption(root: HTMLElement): { caption: string; author: string | null } | null {
  const node = root.querySelector(".Caption");
  if (!node) return null;

  const author = node.querySelector(".CaptionUsername")?.text.trim() || null;
  node.querySelectorAll(".CaptionUsername, .CaptionComments").forEach((el) => el.remove());
  // `.text` decodes the full HTML5 entity table — captions are full of
  // `&eacute;`, `&rsquo;` and `&amp;`, and a hand-rolled table would both miss
  // those and eat a literal `<` in text like `3만원 < 5만원`.
  node.querySelectorAll("br").forEach((br) => br.replaceWith(new TextNode("\n")));

  const caption = node.text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return caption ? { caption, author } : null;
}

/** Full caption, untruncated — the only free source that still returns one. */
async function fetchInstagramEmbed(
  sourceUrl: string,
): Promise<{
  caption: string;
  author: string | null;
  authorImage: string | null;
  thumbnail: string | null;
} | null> {
  try {
    const res = await fetchWithTimeout(`${sourceUrl}embed/captioned/`, {
      headers: { "User-Agent": CRAWLER_UA },
    });
    if (!res.ok) {
      logInstagramFailure("embed", sourceUrl, "http_error", { status: res.status });
      return null;
    }

    const body = await res.text();
    const root = parse(body);
    const thumbnail =
      root.querySelector(".EmbeddedMediaImage")?.getAttribute("src")?.trim() || null;

    // The author's avatar, in the header strip above the media. Two selectors
    // because the embed markup carries both a semantic class and a generic
    // one, and which appears varies by post type — a single selector would
    // silently return null for half of them.
    const authorImage =
      root
        .querySelector(".Avatar img, .EmbedHeader img")
        ?.getAttribute("src")
        ?.trim() || null;

    // Read the thumbnail before parseEmbedCaption, which mutates the tree.
    const parsed = parseEmbedCaption(root);
    if (!parsed) {
      // Name the specific shell we got, so a systematic block is not silently
      // filed as "our selector broke" — the two need opposite responses.
      const shell = root.querySelector(".EmbedBrokenMedia")
        ? { reason: "embed_broken_media_shell" as const, marker: "EmbedBrokenMedia" }
        : root.querySelector('[class*="LoginBlock"], form[action*="/accounts/login"]')
          ? { reason: "login_wall" as const, marker: "login_form" }
          : { reason: "caption_node_missing" as const, marker: undefined };

      logInstagramFailure("embed", sourceUrl, shell.reason, {
        status: res.status,
        chars: body.length,
        marker: shell.marker,
        hasThumbnail: thumbnail !== null,
      });
      return null;
    }

    return { ...parsed, authorImage, thumbnail };
  } catch (cause) {
    const { reason, context } = classifyThrown(cause);
    logInstagramFailure("embed", sourceUrl, reason, context);
    return null;
  }
}

/**
 * og:description reads `46K likes, 361 comments - handle on May 16, 2026: "…"`,
 * where the quoted tail is the caption verbatim, newlines and all. Peeling the
 * engagement envelope off leaves a caption the extractor can read; keeping it
 * would feed the model a like count as if it were part of the post.
 */
export function parseOgCaption(description: string): string | null {
  // Require the engagement counts. Anchoring on the looser `… on …: "…"` shape
  // would also match a caption that merely contains it — `Best brunch on
  // Sunday: "eggs benedict"` would be truncated to the quoted half, throwing
  // away the very place and address lines this pipeline exists to read.
  // `\b` is ASCII-only, so the Korean terms are matched without boundaries —
  // Hangul has no word characters for it to anchor against.
  const hasEngagement =
    /\b(?:likes?|comments?)\b/.test(description) || /좋아요|댓글/.test(description);
  if (!hasEngagement) return null;

  // Take the last `: "` so a quote or a `10:30` clock time earlier in the
  // envelope cannot end the match early; `[\s\S]*` is greedy, so a caption
  // containing its own quotes still survives intact.
  const quoted = description
    // Typographic quotes appear in the envelope on some locales.
    .replace(/[“”]/g, '"')
    .match(/:\s*"([\s\S]*)"\.?\s*$/);
  const caption = (quoted?.[1] ?? "").trim();
  return caption || null;
}

/**
 * Thumbnail, author, and — since the embed endpoint stopped serving captions to
 * the crawler UA — the caption itself, which og:description still carries in
 * full and untruncated.
 */
async function fetchInstagramOgTags(sourceUrl: string): Promise<{
  thumbnail: string | null;
  author: string | null;
  /**
   * Never set here. The og tags describe the *post* — og:image is the media,
   * not the avatar — so this path recovers the handle without a picture, and
   * the UI falls back to the initial. Named anyway so both Instagram paths
   * return the same shape and the caller carries no branch.
   */
  authorImage: null;
  caption: string | null;
}> {
  const empty = {
    thumbnail: null,
    author: null,
    authorImage: null,
    caption: null,
  };
  try {
    const res = await fetchWithTimeout(sourceUrl, {
      headers: { "User-Agent": CRAWLER_UA },
    });
    if (!res.ok) {
      logInstagramFailure("og", sourceUrl, "http_error", { status: res.status });
      return empty;
    }

    const body = await res.text();
    const root = parse(body);
    const meta = (property: string) =>
      root.querySelector(`meta[property="${property}"]`)?.getAttribute("content")?.trim() || null;

    const ogUrl = meta("og:url");
    const thumbnail = meta("og:image");
    const description = meta("og:description");
    if (!thumbnail && !ogUrl && !description) {
      logInstagramFailure("og", sourceUrl, "no_og_tags", {
        status: res.status,
        chars: body.length,
      });
      return empty;
    }

    const caption = description ? parseOgCaption(description) : null;
    if (description && !caption) {
      // The envelope shape changed, or the post has no caption text. Either way
      // the raw string is what a future reader needs to see.
      logInstagramFailure("og", sourceUrl, "og_caption_unparsed", {
        marker: "og:description",
        descriptionChars: description.length,
        // Enough of the envelope to see how its shape changed, cut before the
        // opening quote so the caption body itself stays out of the logs.
        descriptionHead: JSON.stringify(description.split('"')[0].slice(0, 80)),
      });
    }

    // og:url carries the handle as https://www.instagram.com/<handle>/reel/<id>/
    const author = ogUrl?.match(/instagram\.com\/([^/]+)\/(?:p|reel|tv)\//)?.[1] ?? null;
    return { thumbnail, author, authorImage: null, caption };
  } catch (cause) {
    const { reason, context } = classifyThrown(cause);
    logInstagramFailure("og", sourceUrl, reason, context);
    return empty;
  }
}

async function fetchInstagram(sourceUrl: string): Promise<PostMetadata> {
  const base: PostMetadata = {
    sourceUrl,
    platform: Platform.INSTAGRAM,
    title: null,
    caption: null,
    thumbnail: null,
    // Filled in by backupThumbnail() in the ingest route, not here — this
    // module does no storage work.
    thumbnailSource: null,
    author: null,
    authorImage: null,
    authorImageSource: null,
    needsManualCaption: true,
  };

  const embed = await fetchInstagramEmbed(sourceUrl);
  if (embed) {
    return {
      ...base,
      caption: embed.caption,
      author: embed.author,
      authorImage: embed.authorImage,
      thumbnail: embed.thumbnail,
      needsManualCaption: false,
    };
  }

  // Blocked or unparseable: fall back to the preview tags, which still carry
  // the caption in og:description. Only when that is empty too does the user
  // have to paste one — and then the tags at least show the post being asked
  // about.
  const og = await fetchInstagramOgTags(sourceUrl);
  if (og.caption) {
    console.info(
      `[ingest:instagram] caption recovered via og:description chars=${og.caption.length} url=${sourceUrl}`,
    );
  }
  // og:title is only the caption wrapped in `handle on Instagram: "…"`, and the
  // extractor prepends title to caption — carrying it would feed the model a
  // truncated duplicate of text it already has.
  return {
    ...base,
    thumbnail: og.thumbnail,
    author: og.author,
    authorImage: og.authorImage,
    caption: og.caption,
    needsManualCaption: og.caption === null,
  };
}

/**
 * The tagline Naver serves for an id that does not resolve. It comes back in
 * the same og:description slot a real place name would, so without this check
 * a dead link would be geocoded as if "모든 여정의 시작" were a restaurant.
 */
const NAVER_MAP_PLACEHOLDER = "모든 여정의 시작";

/**
 * Follows a share-sheet short link to the place id behind it. The redirect
 * chain ends on a vendor URL that {@link classifyUrl} already knows how to
 * read, so the landing URL is fed straight back through it.
 */
async function resolveShortLink(
  ref: Extract<MapPlaceRef, { shortUrl: string }>,
): Promise<Extract<MapPlaceRef, { id: string }>> {
  let landing: string;
  try {
    const res = await fetchWithTimeout(ref.shortUrl, {
      headers: { "User-Agent": CRAWLER_UA },
      redirect: "follow",
    });
    landing = res.url;
  } catch {
    throw new UnsupportedUrlError(ref.shortUrl);
  }

  // A short link that expired or never existed lands back on itself or on a
  // vendor home page. classifyUrl rejects those outright, so the throw is
  // caught here to name the link the user actually pasted.
  let resolved: MapPlaceRef | undefined;
  try {
    resolved = classifyUrl(landing).mapPlace;
  } catch {
    throw new UnsupportedUrlError(ref.shortUrl);
  }
  if (!resolved || !("id" in resolved)) {
    throw new UnsupportedUrlError(ref.shortUrl);
  }
  return resolved;
}

/**
 * Reads a place name off a map page. Neither vendor exposes an API for this,
 * but both render the name into og tags for link previews: Naver puts it in
 * og:description (og:title is always the literal string "네이버지도"), and
 * Kakao puts the name in og:title with the address in og:description.
 */
async function fetchMapPlace(
  sourceUrl: string,
  ref: MapPlaceRef,
): Promise<PostMetadata> {
  const base: PostMetadata = {
    sourceUrl,
    platform: platformOf(ref),
    title: null,
    caption: null,
    thumbnail: null,
    // Both vendors serve unsigned og:image URLs, so there is nothing to back up.
    thumbnailSource: null,
    author: null,
    authorImage: null,
    authorImageSource: null,
    // A map link never needs one: it names a place outright, so there is no
    // prose for the user to supply.
    needsManualCaption: false,
  };

  const res = await fetchWithTimeout(sourceUrl, {
    headers: { "User-Agent": CRAWLER_UA },
    redirect: "follow",
  });
  if (!res.ok) throw new UnsupportedUrlError(sourceUrl);

  const root = parse(await res.text());
  const meta = (property: string) =>
    root
      .querySelector(`meta[property="${property}"]`)
      ?.getAttribute("content")
      ?.trim() || null;

  const ogTitle = meta("og:title");
  const ogDescription = meta("og:description");

  const name = ref.vendor === "naver" ? ogDescription : ogTitle;
  // Kakao's og:description is the road address, which sharpens the geocode
  // lookup the same way a caption's area hint does. Naver gives us no address.
  const hint = ref.vendor === "kakao" ? ogDescription : null;

  if (!name || name.includes(NAVER_MAP_PLACEHOLDER)) {
    throw new UnsupportedUrlError(sourceUrl);
  }

  // Kakao serves og:image protocol-relative (`//img1.kakaocdn.net/…`), which
  // POST /api/posts rejects for not being an http(s) URL — the save would 400
  // on a link the ingest just accepted.
  const image = meta("og:image");
  const thumbnail = image?.startsWith("//") ? `https:${image}` : image;

  return {
    ...base,
    title: name,
    thumbnail,
    place: { name, hint },
  };
}

/**
 * Classifies and canonicalizes a URL without any network call, for the retry
 * where the user has pasted the caption and the remote fetch has nothing left
 * to contribute. Callers that need title, author or thumbnail must still go
 * through {@link fetchMetadata}.
 */
export function describePost(rawUrl: string): PostMetadata {
  const { platform, url, youtubeId, mapPlace } = classifyUrl(rawUrl);
  return {
    sourceUrl: canonicalize(platform, url, youtubeId, mapPlace),
    platform,
    title: null,
    caption: null,
    thumbnail: null,
    thumbnailSource: null,
    author: null,
    authorImage: null,
    authorImageSource: null,
    // Nothing was fetched, so on its own this post still needs a caption. The
    // caller supplying one overrides this alongside `caption`.
    needsManualCaption: true,
  };
}

export async function fetchMetadata(rawUrl: string): Promise<PostMetadata> {
  const { platform, url, youtubeId, mapPlace } = classifyUrl(rawUrl);
  const sourceUrl = canonicalize(platform, url, youtubeId, mapPlace);

  if (platform === Platform.YOUTUBE && youtubeId) {
    return fetchYouTube(sourceUrl, youtubeId);
  }
  if (mapPlace) {
    // A short link carries no id, so following it is the only way to learn
    // which place it names — and where the canonical URL should point.
    const resolved = "shortUrl" in mapPlace ? await resolveShortLink(mapPlace) : mapPlace;
    return fetchMapPlace(
      canonicalize(platform, url, youtubeId, resolved),
      resolved,
    );
  }
  return fetchInstagram(sourceUrl);
}
