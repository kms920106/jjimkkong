import { z } from "zod";

/**
 * Naver blog reviews for a place, by name.
 *
 * ## Why this exists
 *
 * The place sheet could say what a map app says — name, category, address —
 * and nothing a person actually wants before going somewhere: whether the
 * place is any good lately. Blog search answers that, and unlike the place
 * photo this app tried and reverted, nothing in Naver's terms forbids storing
 * the handful of fields rendered here.
 *
 * ## sort=date, not the API default
 *
 * **This is the decision the feature lives or dies on.** `sim` is the API
 * default and is what lib/ingest/place-image.ts passes, so copying that module
 * without reading this comment silently stores garbage. Measured 2026-08-30
 * against the live API:
 *
 * | query      | sort=sim                                    | sort=date                    |
 * |------------|---------------------------------------------|------------------------------|
 * | 대림창고    | a 2018 pool guide, 2013 roof waterproofing  | 대림창고 gallery/shop reviews |
 * | 어니언 성수 | a 2020 photo outing, a Final Fantasy 6 FAQ  | 어니언 성수 cafe reviews ×3   |
 *
 * Every `sim` result was an unrelated 2013–2018 tistory post; every `date`
 * result was a blog.naver.com review of the actual venue from the past week.
 * Relevance ranking on a bare venue name is evidently dominated by whole-corpus
 * term frequency, and recency is the better proxy for "someone wrote about this
 * place". Do not switch this back.
 *
 * ## The known weakness: no result is ever "no match"
 *
 * Naver matches on partial tokens, so a venue nobody has written about does not
 * come back empty — it comes back with whatever shares a fragment of the name.
 * Measured: `없는가게999` returns three posts, one of them a diaper shop in
 * Daejeon, because `999` and `없는` matched separately.
 *
 * There is no signal in the response that separates this from a real hit: no
 * score, and `total` is small for genuine niche venues too. So an obscure place
 * shows a few unrelated posts rather than an empty section, and that is the
 * accepted cost of the feature as built. If it needs fixing, the honest fix is
 * a relevance check against the place name *here* — before the write, since the
 * row is immutable — not a filter at render, which would leave the junk in the
 * database for every other consumer.
 *
 * ## Keys
 *
 * The same `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` pair geocoding uses —
 * verified against the live endpoint, not assumed. That is worth stating
 * because the neighbouring place-image module needs its *own* application:
 * Naver enables each API per application, so whether one key pair reaches two
 * endpoints depends on how that application was registered, and this account's
 * has both 지역 검색 and 블로그 검색 enabled. If a future deployment answers
 * 401 "요청한 API는 이 Application에서 활성화되어 있지 않습니다", the fix is to
 * enable blog search on that application (or add a separate key pair here),
 * not to change this code.
 *
 * The daily search quota (25,000) is shared with local search. This costs one
 * call per place on the first save of a link only — `Post` is immutable, so a
 * re-save never reaches here.
 *
 * ## This module never throws
 *
 * Same contract as post-thumbnail.ts and lib/ingest/place-image.ts. Reviews are
 * decoration on work the user asked for; a missing key or a bad day at Naver
 * must cost the save nothing. Every failure resolves to an empty list.
 */

const ENDPOINT = "https://naverapihub.apigw.ntruss.com/search/v1/blog";

/**
 * Matches geocode.ts. Measured latency is 70–185ms, so this is a ceiling
 * against a hang rather than a limit real traffic approaches.
 */
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Matches geocode.ts, and for the same reason: Naver rejects bursts from a
 * single client id. Raise it and the failure mode is 429s, which here surface
 * as places quietly having no reviews.
 */
const CONCURRENCY = 3;

/** How many reviews a place keeps. Also the `display` parameter. */
const MAX_BLOGS = 5;

/**
 * Ceilings on the stored strings. Measured across 100 real results: title 61,
 * description 178, bloggername 27, link 50 — so these are roughly 4x headroom
 * and no real row is truncated.
 *
 * They exist because the values are external and the columns are unbounded
 * `TEXT`: without a cap, one oversized response writes an arbitrarily large row
 * that no re-save can shrink (the row is immutable) and that every member who
 * saved a post naming this place then downloads. The route bounds its own body
 * with Zod `.max()` for the same reason; this is that boundary for a value that
 * arrives from Naver instead of from the client.
 *
 * A `link` past the limit is dropped rather than truncated — a cut URL is a
 * broken link, and the entry's only purpose is to be clickable.
 */
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 1_000;
const MAX_BLOGGERNAME = 200;
const MAX_LINK = 2_000;

/**
 * Only the fields that are stored. The response also carries `bloggerlink`,
 * which nothing renders — the blogger's name is shown as plain text beside the
 * post, not as a second link competing with the post's own.
 *
 * Validated rather than cast for the reason extract.ts validates the model
 * response: this is a network boundary, and a shape change should surface as a
 * place with no reviews rather than as `undefined` reaching the database.
 */
const BlogResponseSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string(),
        link: z.string(),
        description: z.string(),
        bloggername: z.string(),
        postdate: z.string(),
      }),
    )
    .optional(),
});

/** One review, cleaned and ready to store. */
export type PlaceBlogEntry = {
  title: string;
  link: string;
  description: string;
  bloggername: string;
  postdate: string;
};

export type PlaceBlogQuery = {
  /** The resolved place name, as stored on the row. */
  name: string;
  /** Area hint, used exactly as geocode.ts uses it. */
  hint: string | null;
};

/**
 * Naver marks query matches with `<b>` in both `title` and `description`, and
 * escapes quotes as `&quot;` (observed in real responses). Rendering either
 * verbatim shows markup to the user, and the column is written once into a
 * shared row, so it has to be clean going in.
 *
 * **Decode first, then strip — the order is the whole point.** Stripping first
 * lets a title containing `&lt;script&gt;` decode into a literal `<script>`
 * *after* the stripper has already run, so the stored string is markup again.
 * React escapes it, so that is not an XSS here today; it is a live payload
 * sitting in a shared, immutable row waiting for the first consumer that is not
 * React — an OG description, a feed, a native client — and no re-save can clean
 * it. Decoding first means the stripper sees that markup and removes it.
 *
 * The `&amp;` case is why decoding runs in two passes rather than one: `&amp;`
 * must become `&` last (otherwise `&amp;lt;` would turn into `<`), but that
 * leaves any tag it just revealed unstripped. Stripping after the whole decode
 * catches both.
 *
 * geocode.ts has its own tag stripper and deliberately not this: it reads short
 * place names where entities do not appear. Sharing one helper would mean
 * exporting a private function across a module boundary that has nothing else
 * in common, so the duplication is the cheaper of the two.
 *
 * Only the five entities Naver's own escaping produces. This is not a general
 * HTML decoder and must not grow into one — the input is a search response, not
 * arbitrary markup.
 */
function cleanText(html: string): string {
  const decoded = html
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Ampersand last, so "&amp;lt;" ends up as the text "&lt;" and not as "<".
    .replace(/&amp;/g, "&");

  // Repeated until it stops changing: one pass over `<<b>b>` removes the inner
  // `<b>` and leaves `b>`, because the stripper cannot match a tag that only
  // exists once an overlapping one is gone. Bounded by the fact that each pass
  // that changes anything strictly shortens the string.
  let stripped = decoded;
  for (;;) {
    const next = stripped.replace(/<[^>]*>/g, "");
    if (next === stripped) break;
    stripped = next;
  }

  // Whatever angle brackets survive are unpaired leftovers, not tags. Dropped
  // rather than kept because this column is written once into a row every
  // member shares and no re-save can repair — it should hold text, and a stray
  // `>` is not text anyone wrote.
  return stripped.replace(/[<>]/g, "").trim();
}

/** Resolves to the top results for one query, or an empty list on any failure. */
async function search(query: string): Promise<PlaceBlogEntry[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  // These are required for geocoding, so in practice a save cannot get this far
  // without them. Handled anyway because this module's whole contract is that
  // it cannot be the reason a save fails.
  if (!clientId || !clientSecret) {
    console.info("[ingest:place-blog] skipped: no_key");
    return [];
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(MAX_BLOGS));
  // See the module comment. Not the API default, and not what place-image.ts
  // passes — the measurements that forced this are recorded there.
  url.searchParams.set("sort", "date");

  try {
    const res = await fetch(url, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(`[ingest:place-blog] http_error status=${res.status}`);
      return [];
    }

    const parsed = BlogResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("[ingest:place-blog] unexpected_shape");
      return [];
    }

    return (parsed.data.items ?? [])
      .map((item) => ({
        title: cleanText(item.title).slice(0, MAX_TITLE),
        link: item.link,
        description: cleanText(item.description).slice(0, MAX_DESCRIPTION),
        bloggername: cleanText(item.bloggername).slice(0, MAX_BLOGGERNAME),
        postdate: item.postdate,
      }))
      // An entry whose link is unusable is dropped, not stored: the whole point
      // of a review here is that it can be opened. `http(s)` only — the value
      // becomes an href, and a `javascript:` URL from a compromised or
      // unexpected response must never reach the DOM. Naver has only ever
      // returned https, so this rejects nothing real.
      .filter((blog) => {
        if (blog.link.length > MAX_LINK) return false;
        try {
          const { protocol } = new URL(blog.link);
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      })
      // Deduped on the URL, which is the identity of a review here. Naver can
      // list one post twice when it is indexed under variant URLs, and a
      // duplicate would otherwise burn one of the five slots in a row that can
      // never be rewritten. Doing it here rather than at render also keeps the
      // stored list honest — the sheet keys its list items on `link`, and two
      // identical keys make React drop a row.
      .filter(
        (blog, index, all) =>
          all.findIndex((other) => other.link === blog.link) === index,
      );
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.warn(`[ingest:place-blog] request_failed ${name}`);
    return [];
  }
}

/**
 * Reviews for one place.
 *
 * Uses the hint-qualified query for the reason geocode.ts does — a bare
 * `런던베이글뮤지엄` returns the 부산, 여의도 and 수원 branches mixed together —
 * but unlike geocoding it does not retry unqualified. A name that missed with
 * its district attached tends to match something else entirely, and reviews of
 * the wrong venue are worse than none: `Place` is shared, so they would appear
 * under that pin for every member.
 */
async function findOne(place: PlaceBlogQuery): Promise<PlaceBlogEntry[]> {
  const query = place.hint ? `${place.hint} ${place.name}` : place.name;
  return search(query);
}

/**
 * Reviews for a list of places, aligned to the input by index.
 *
 * Written by index rather than pushed, exactly as geocodeCandidates() and
 * findPlaceImages() are: the caller zips this against its own array
 * positionally, so appending would attach one place's reviews to another once
 * completions arrive out of order.
 */
export async function findPlaceBlogs(
  places: PlaceBlogQuery[],
): Promise<PlaceBlogEntry[][]> {
  const results: PlaceBlogEntry[][] = Array.from(
    { length: places.length },
    () => [],
  );
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= places.length) return;
      results[index] = await findOne(places[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, places.length) }, worker),
  );

  return results;
}
