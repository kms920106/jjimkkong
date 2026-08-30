import { z } from "zod";

/**
 * Finding a photo of a place, by name.
 *
 * **Currently unused.** POST /api/posts no longer calls this — the save path
 * was reverted to store no place photo. The module is kept intact, along with
 * the `Place.image`/`imageSource` columns, so the feature can be switched back
 * on without redoing the research below.
 *
 * ## Why this exists at all
 *
 * No place API this app can use returns a picture. Naver's local search — the
 * one geocode.ts calls — has no image field, Kakao's local API has none
 * either, and Google Places has photos but its terms forbid storing them
 * (place_id is the single exemption). That is why `Place` had no image column
 * for so long, and the reasoning is written up in the root AGENTS.md.
 *
 * Naver's *image search* is a different endpoint on the same gateway, and it
 * does answer the question. Measured against 20 real `Place` rows on
 * 2026-08-29: 18 resolved, 0 failures, 135ms median. The method and the two
 * misses are in docs/naver-search/IMAGE-SEARCH-VERIFY.md.
 *
 * ## Two keys, not one
 *
 * `NAVER_IMAGE_CLIENT_ID` / `NAVER_IMAGE_CLIENT_SECRET` are a *separate NCP
 * application* from the local-search pair. Naver enables each API per
 * application, so passing the geocoding keys here answers a 401 that says
 * "요청한 API는 이 Application에서 활성화되어 있지 않습니다" rather than
 * anything about the key being wrong. Do not collapse them into one variable.
 *
 * The daily search quota (25,000) is shared with local search, which is what
 * keeps this to one round per post: `Post` is immutable, so a re-save short
 * circuits before reaching here.
 *
 * ## This module never throws
 *
 * Same contract as post-thumbnail.ts and for the same reason: a place photo is
 * decoration on work the user asked for. A missing key or a bad day at Naver
 * must cost the save nothing. Every failure resolves to null.
 */

const ENDPOINT = "https://naverapihub.apigw.ntruss.com/search/v1/image";

/**
 * Matches geocode.ts. A place lookup and a place photo are the same kind of
 * call against the same gateway, and the save path pays both inside one 60s
 * route — a more patient timeout here would spend the geocoder's budget.
 */
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Matches geocode.ts, and for the same reason: Naver rejects bursts from a
 * single client id. Raise it and the failure mode is 429s, which here surface
 * as places quietly having no photo. Do not raise it to make saves faster.
 */
const CONCURRENCY = 3;

/**
 * Only the fields this module reads. The response also carries `title`,
 * `sizeheight` and `sizewidth`; none of them decide anything here, and parsing
 * what is unused invents ways to fail.
 *
 * Validated rather than cast for the reason extract.ts validates the model
 * response: this is a network boundary, and a shape change should surface as a
 * null photo rather than as `undefined` reaching the blob fetch.
 */
const ImageResponseSchema = z.object({
  items: z
    .array(
      z.object({
        /** Naver's own re-host of the image. The only URL this app fetches. */
        thumbnail: z.string().url(),
      }),
    )
    .optional(),
});

export type PlaceImageQuery = {
  /** The resolved place name, as stored on the row. */
  name: string;
  /** Area hint, used exactly as geocode.ts uses it. */
  hint: string | null;
};

/**
 * Resolves to the top result's thumbnail URL, or null when there is no usable
 * photo and on every failure.
 */
async function search(query: string): Promise<string | null> {
  const clientId = process.env.NAVER_IMAGE_CLIENT_ID;
  const clientSecret = process.env.NAVER_IMAGE_CLIENT_SECRET;
  // Absent keys are the normal state of a checkout that has not set up image
  // search. Logged once at info, not warn: nothing is broken.
  if (!clientId || !clientSecret) {
    console.info("[ingest:place-image] skipped: no_key");
    return null;
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  // One result. Only the top hit is ever stored, so asking for more would pay
  // for candidates this code has no criterion to choose between.
  url.searchParams.set("display", "1");
  url.searchParams.set("sort", "sim");
  // Large images only, and this is load-bearing rather than a quality
  // preference. Dropping it was measured: the two places that found nothing
  // stayed empty or returned a district press release — i.e. relaxing the
  // filter buys a *wrong* photo, which is worse than no photo, since a wrong
  // one is shared onto every member's pin for that place.
  url.searchParams.set("filter", "large");

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
      console.warn(`[ingest:place-image] http_error status=${res.status}`);
      return null;
    }

    const parsed = ImageResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("[ingest:place-image] unexpected_shape");
      return null;
    }

    return parsed.data.items?.[0]?.thumbnail ?? null;
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.warn(`[ingest:place-image] request_failed ${name}`);
    return null;
  }
}

/**
 * One place. Tries the hint-qualified query first for the reason geocode.ts
 * does — "성수동 대림창고" beats "대림창고" when the name repeats across
 * neighbourhoods — but unlike geocoding it does not retry unqualified. A bare
 * name that missed with its district attached tends to match something else
 * entirely, and an unrelated photo is worse than none because `Place` is
 * shared: it would become the picture on every member's pin for that place.
 */
async function findOne(place: PlaceImageQuery): Promise<string | null> {
  const query = place.hint ? `${place.hint} ${place.name}` : place.name;
  return search(query);
}

/**
 * Photos for a list of places, aligned to the input by index.
 *
 * Written by index rather than pushed, exactly as geocodeCandidates() is: the
 * caller zips this against its own array positionally, so appending would
 * attach photos to the wrong places once completions arrive out of order.
 */
export async function findPlaceImages(
  places: PlaceImageQuery[],
): Promise<(string | null)[]> {
  const results = new Array<string | null>(places.length).fill(null);
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
