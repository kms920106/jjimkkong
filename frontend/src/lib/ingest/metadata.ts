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

function logInstagramFailure(step: string, sourceUrl: string, cause: unknown) {
  const reason =
    cause instanceof DOMException && cause.name === "TimeoutError"
      ? "timeout"
      : cause instanceof Error
        ? cause.message
        : String(cause);
  console.warn(`[ingest:instagram] ${step} failed (${reason}): ${sourceUrl}`);
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
      logInstagramFailure("embed", sourceUrl, new Error(`http_${res.status}`));
      return null;
    }

    const root = parse(await res.text());
    const thumbnail =
      root.querySelector(".EmbeddedMediaImage")?.getAttribute("src")?.trim() || null;

    // Read the thumbnail before parseEmbedCaption, which mutates the tree.
    const parsed = parseEmbedCaption(root);
    if (!parsed) {
      // Either a login wall or a video that rendered a "Watch on Instagram"
      // placeholder instead of the caption.
      logInstagramFailure("embed", sourceUrl, new Error("no_caption_in_markup"));
      return null;
    }

    return { ...parsed, thumbnail };
  } catch (cause) {
    logInstagramFailure("embed", sourceUrl, cause);
    return null;
  }
}

/**
 * Thumbnail and author only. The post page withholds og:title and
 * og:description even from the crawler UA, so it cannot supply a caption.
 */
async function fetchInstagramOgTags(
  sourceUrl: string,
): Promise<{ thumbnail: string | null; author: string | null }> {
  try {
    const res = await fetchWithTimeout(sourceUrl, {
      headers: { "User-Agent": CRAWLER_UA },
    });
    if (!res.ok) {
      logInstagramFailure("og", sourceUrl, new Error(`http_${res.status}`));
      return { thumbnail: null, author: null };
    }

    const root = parse(await res.text());
    const meta = (property: string) =>
      root.querySelector(`meta[property="${property}"]`)?.getAttribute("content")?.trim() || null;

    const ogUrl = meta("og:url");
    const thumbnail = meta("og:image");
    if (!thumbnail && !ogUrl) {
      logInstagramFailure("og", sourceUrl, new Error("no_og_tags"));
    }

    // og:url carries the handle as https://www.instagram.com/<handle>/reel/<id>/
    const author = ogUrl?.match(/instagram\.com\/([^/]+)\/(?:p|reel|tv)\//)?.[1] ?? null;
    return { thumbnail, author };
  } catch (cause) {
    logInstagramFailure("og", sourceUrl, cause);
    return { thumbnail: null, author: null };
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

  // Blocked or unparseable: keep whatever the preview tags still expose so the
  // manual-caption form can show the post it is asking about.
  const og = await fetchInstagramOgTags(sourceUrl);
  return { ...base, thumbnail: og.thumbnail, author: og.author };
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
