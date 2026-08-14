import { parse, type HTMLElement, TextNode } from "node-html-parser";
import { Platform } from "@/generated/prisma/enums";

export type PostMetadata = {
  sourceUrl: string;
  platform: Platform;
  title: string | null;
  caption: string | null;
  thumbnail: string | null;
  author: string | null;
  /** True when the caption could not be fetched and the user must paste it. */
  needsManualCaption: boolean;
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

  throw new UnsupportedUrlError(raw);
}

/** Strips tracking params so the same post always yields one stored row. */
function canonicalize(platform: Platform, url: URL, youtubeId?: string): string {
  if (platform === Platform.YOUTUBE && youtubeId) {
    return `https://www.youtube.com/watch?v=${youtubeId}`;
  }
  if (platform === Platform.INSTAGRAM) {
    const [, kind, shortcode] = url.pathname.split("/");
    // The same post is reachable as /reel/, /reels/, /tv/ and /p/. Collapsing
    // them keeps the (userId, sourceUrl) dedupe key stable and stores a
    // permalink that actually resolves — /reels/<code>/ 404s.
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
    author: null,
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
          thumbnail:
            snippet.thumbnails?.maxres?.url ??
            snippet.thumbnails?.high?.url ??
            base.thumbnail,
        };
      }
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
): Promise<{ caption: string; author: string | null; thumbnail: string | null } | null> {
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

    return { ...parsed, thumbnail };
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
  caption: string | null;
}> {
  const empty = { thumbnail: null, author: null, caption: null };
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
    return { thumbnail, author, caption };
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
    author: null,
    needsManualCaption: true,
  };

  const embed = await fetchInstagramEmbed(sourceUrl);
  if (embed) {
    return {
      ...base,
      caption: embed.caption,
      author: embed.author,
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
    caption: og.caption,
    needsManualCaption: og.caption === null,
  };
}

/**
 * Classifies and canonicalizes a URL without any network call, for the retry
 * where the user has pasted the caption and the remote fetch has nothing left
 * to contribute. Callers that need title, author or thumbnail must still go
 * through {@link fetchMetadata}.
 */
export function describePost(rawUrl: string): PostMetadata {
  const { platform, url, youtubeId } = classifyUrl(rawUrl);
  return {
    sourceUrl: canonicalize(platform, url, youtubeId),
    platform,
    title: null,
    caption: null,
    thumbnail: null,
    author: null,
    // Nothing was fetched, so on its own this post still needs a caption. The
    // caller supplying one overrides this alongside `caption`.
    needsManualCaption: true,
  };
}

export async function fetchMetadata(rawUrl: string): Promise<PostMetadata> {
  const { platform, url, youtubeId } = classifyUrl(rawUrl);
  const sourceUrl = canonicalize(platform, url, youtubeId);

  if (platform === Platform.YOUTUBE && youtubeId) {
    return fetchYouTube(sourceUrl, youtubeId);
  }
  return fetchInstagram(sourceUrl);
}
