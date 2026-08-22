import { createHash } from "node:crypto";

import { getCache } from "@vercel/functions";
import { z } from "zod";

import type { PlaceCandidate } from "./extract";

export type GeocodedCandidate = {
  /** Model-extracted name; re-sent to /api/posts as the search term on save. */
  query: string;
  /** Area hint the model found, needed to re-run this lookup on save. */
  hint: string | null;
  matched: boolean;
  /**
   * True when the lookup itself failed (timeout, quota, 5xx) rather than
   * returning no result — the UI must not tell the user the place is absent
   * from the map when the service was simply unreachable.
   */
  lookupFailed: boolean;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: string | null;
  naverLink: string | null;
};

type NaverLocalItem = {
  title: string;
  link?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  mapx?: string;
  mapy?: string;
};

const ENDPOINT = "https://naverapihub.apigw.ntruss.com/search/v1/local";
const FETCH_TIMEOUT_MS = 5_000;

/**
 * One save costs two full rounds of this module: POST /api/ingest geocodes to
 * show the pins, then POST /api/posts geocodes the *same* names again because
 * it refuses client-supplied coordinates. That second round is a security
 * boundary and cannot be dropped — so it is served from cache instead, which
 * removes the wait without weakening it: what is cached is Naver's own answer
 * to a query string, so the row still only ever holds values this server
 * derived, never ones a caller supplied. That holds only because the cache key
 * is collision-resistant — see `hashKey` below, which is what makes the
 * sentence above true rather than merely plausible.
 *
 * Long enough to cover the user's own confirm step with room for a retry, short
 * enough that a place that moves or closes is not pinned to a stale address for
 * the rest of the day.
 */
const CACHE_TTL_SECONDS = 600;

/**
 * Cached entries are re-validated on read, exactly as `extract.ts` re-validates
 * the LLM response even under a `strict` schema. The cache is an external store
 * that outlives deployments, so an entry written by an older shape can be read
 * by newer code — and an unvalidated one would flow straight into
 * `toDegrees(item.mapx)` and then into a shared `Place` row.
 *
 * The wrapper object is what separates a cached "genuinely no match" (`{ item:
 * null }`, truthy) from a cache miss (null/undefined). Do not flatten it to
 * `NaverLocalItem | null` — a no-match would then re-query on every read.
 */
const CachedSearchSchema = z.object({
  item: z
    .object({
      title: z.string(),
      link: z.string().optional(),
      category: z.string().optional(),
      address: z.string().optional(),
      roadAddress: z.string().optional(),
      mapx: z.string().optional(),
      mapy: z.string().optional(),
    })
    .nullable(),
});

/**
 * SHA-256 rather than the library default, and this is load-bearing security
 * rather than tidiness. `@vercel/functions` hashes keys with djb2-xor truncated
 * to 32 bits and stores *only* that digest — the query string itself is not part
 * of the key. Second preimages are therefore trivial: `"6foblaih"` and
 * `"성수동 대림창고"` both hash to `f7eeb594`.
 *
 * That matters because of what reads this cache. `POST /api/posts` re-geocodes
 * server-side precisely so a caller cannot choose the coordinates written to a
 * globally shared `Place` row. With a forgeable key, any signed-in caller could
 * ingest a colliding string, have its Naver result stored under a real place
 * name's slot, and control what the *next* user's save resolves to — the same
 * pin-moving attack that refusing client lat/lng exists to prevent, reintroduced
 * one layer down. A collision-resistant digest removes the primitive.
 *
 * Do not drop this back to the default, and do not "simplify" it to a
 * per-user namespace: that closes the hole but discards the cross-user sharing
 * that is the entire point of caching a public vendor record.
 */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * A place name is not user-identifying and the response is the vendor's public
 * record, so entries are shared across users on purpose — two people saving the
 * same viral reel pay for one lookup.
 *
 * Namespace is versioned so a future change to the stored shape can never read
 * entries written by the old one.
 *
 * Resolved lazily rather than at module scope: `getCache()` is documented to
 * throw when no cache can be constructed, and at module scope that would be an
 * import-time crash no per-call catch could absorb. The library memoizes the
 * underlying instance, so calling it per request costs nothing.
 */
function localSearchCache() {
  return getCache({ namespace: "naver-local-v1", keyHashFunction: hashKey });
}

/**
 * Only a resolved lookup is cached. A `LookupFailedError` propagates out before
 * the write below, and must keep doing so: caching it would pin `lookupFailed`
 * on for the whole TTL, so the retry the UI explicitly asks the user to make
 * would be answered from cache without ever touching Naver again.
 */
async function cachedSearch(query: string): Promise<NaverLocalItem | null> {
  // Nothing is written to the cache until the fetch returns, so concurrent
  // identical queries all miss and all hit Naver — and the concurrency below
  // makes that likely rather than theoretical: one post naming the same place
  // twice, or two candidates whose hint-qualified and bare queries coincide.
  // Collapsing them in flight serves the same "do not burst one client id"
  // constraint the concurrency limit does.
  const pending = inFlight.get(query);
  if (pending) return pending;

  const promise = resolveSearch(query);
  inFlight.set(query, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(query);
  }
}

/**
 * Entries live only as long as the lookup — the `finally` below removes them on
 * both fulfillment and rejection, so this is bounded by concurrent lookups
 * rather than by history.
 *
 * Module scope means it is shared across concurrent requests in a warm
 * instance, not merely within one. That is intended: the value is Naver's
 * answer to a specific query string, which is identical no matter who asked,
 * and it carries no per-user state. Do not key it by user to "isolate" it —
 * that would defeat the point for the same reason a per-user cache namespace
 * would.
 */
const inFlight = new Map<string, Promise<NaverLocalItem | null>>();

async function resolveSearch(query: string): Promise<NaverLocalItem | null> {
  // A degraded cache must mean a slower save, not a failed one — the same
  // contract as post-thumbnail.ts. Note the library already substitutes an
  // in-memory cache (with a warning) when the Runtime Cache is absent, as in
  // `next dev` and the one-off scripts, so this guards genuine faults and a
  // stale entry shape rather than the no-cache environment.
  try {
    const hit = CachedSearchSchema.safeParse(await localSearchCache().get(query));
    if (hit.success) return hit.data.item;
  } catch {
    // Treat as a miss and pay for the lookup.
  }

  const item = await search(query);

  // Deliberately not awaited. `get`/`set` carry their own ~500ms timeout that
  // resolves silently, and awaiting the write would put it on the critical path
  // of a request that already holds its answer — spending latency to save
  // latency. Errors are swallowed for the same reason the write is best effort.
  //
  // `name` is passed explicitly and must stay that way. It is only a label in
  // Vercel's cache UI, but the library defaults it to `options?.name ?? key` —
  // the *raw query* — and then sends it as the `x-vercel-cache-item-name` HTTP
  // header. Header values are ByteStrings, so any codepoint above 255 throws
  // inside fetch, and `BuildCache.set` swallows that in its own try/catch and
  // resolves normally. Every Korean place name would therefore fail to cache,
  // silently: the `.catch()` below never fires and `get` just keeps missing.
  // Almost every name this app geocodes is Korean, so the default makes the
  // whole cache a no-op in production — while `next dev` hides it, because the
  // in-memory fallback ignores `name` entirely and stores those keys fine.
  void localSearchCache()
    .set(
      query,
      { item },
      {
        ttl: CACHE_TTL_SECONDS,
        tags: ["naver-local"],
        // The digest is header-safe by construction, which is the second job
        // the SHA-256 key hash does: it keeps the query out of the transport
        // layer as well as out of the key.
        name: hashKey(query),
      },
    )
    .catch(() => {});

  return item;
}

class LookupFailedError extends Error {
  constructor() {
    super("Naver local search is unavailable");
    this.name = "LookupFailedError";
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * Local Search returns mapx/mapy as WGS84 degrees scaled by 1e7 (e.g.
 * "1270276368" -> 127.0276368). Older docs describe a KATECH projection; that
 * format is no longer returned by this endpoint.
 */
function toDegrees(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n / 1e7;
}

/** Resolves to the top hit, null when there is genuinely no match. */
async function search(query: string): Promise<NaverLocalItem | null> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET are not set");
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("display", "1");

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new LookupFailedError();
  }

  // 429 and 5xx mean "ask again later", not "this place does not exist".
  if (!res.ok) throw new LookupFailedError();

  const body = (await res.json()) as { items?: NaverLocalItem[] };
  return body.items?.[0] ?? null;
}

async function geocodeOne(
  candidate: PlaceCandidate,
): Promise<GeocodedCandidate> {
  const base = {
    query: candidate.name,
    hint: candidate.hint,
    matched: false,
    lookupFailed: false,
    name: candidate.name,
    address: "",
    lat: 0,
    lng: 0,
    category: null,
    naverLink: null,
  } satisfies GeocodedCandidate;

  // Try the hint-qualified query first — "성수동 대림창고" beats "대림창고"
  // when the same name exists in several neighborhoods.
  const queries = candidate.hint
    ? [`${candidate.hint} ${candidate.name}`, candidate.name]
    : [candidate.name];

  let sawFailure = false;

  for (const query of queries) {
    let item: NaverLocalItem | null;
    try {
      item = await cachedSearch(query);
    } catch (error) {
      if (error instanceof LookupFailedError) {
        // Fall through to the un-hinted query — one hiccup should not discard
        // the attempt that was more likely to match anyway.
        sawFailure = true;
        continue;
      }
      throw error;
    }
    if (!item) continue;

    const lng = toDegrees(item.mapx);
    const lat = toDegrees(item.mapy);
    if (lat === null || lng === null) continue;

    return {
      ...base,
      matched: true,
      name: stripTags(item.title) || candidate.name,
      address: item.roadAddress || item.address || "",
      lat,
      lng,
      category: item.category || null,
      naverLink: item.link || null,
    };
  }

  return { ...base, lookupFailed: sawFailure };
}

/**
 * Naver's local search rejects bursts from one client id, so this is not
 * `Promise.all`. But fully sequential was not the only alternative: a post
 * naming 5 places costs up to 10 sequential round trips, and at 5s of timeout
 * each that alone can outrun the route's 60s budget.
 *
 * A small window keeps the burst shape Naver tolerates while cutting the
 * wall-clock by roughly this factor. Lower it if 429s appear — `lookupFailed`
 * rising in the logs is the signal, and it is the reason that flag is kept
 * distinct from `matched: false`.
 */
const CONCURRENCY = 3;

export async function geocodeCandidates(
  candidates: PlaceCandidate[],
  /**
   * Called after each candidate resolves, with how many are finished. Lets the
   * ingest route stream "3/5" while this runs — it is the one stage whose
   * duration scales with the post rather than the network, so it is the one
   * worth counting. Never called with a partial result: the caller gets counts
   * only, since a half-filled array must not escape this function.
   *
   * A throw from here is swallowed. Progress reporting is a courtesy on top of
   * the lookup, and letting it reject the worker would discard every candidate
   * already resolved — turning a cosmetic concern into a failed ingest.
   */
  onProgress?: (done: number, total: number) => void,
): Promise<GeocodedCandidate[]> {
  // Written by index rather than pushed: POST /api/posts zips this array
  // against its own `places` array positionally to attach each memo, and
  // /links renders `position` from the same alignment. Completion order here
  // is not request order, so appending would silently reattach memos to the
  // wrong places.
  const results = new Array<GeocodedCandidate>(candidates.length);
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= candidates.length) return;
      results[index] = await geocodeOne(candidates[index]);
      // Counts completions, not the index, because workers finish out of order.
      done++;
      try {
        onProgress?.(done, candidates.length);
      } catch {
        // See the parameter's contract: never fail the lookup over a progress
        // report the caller could not deliver.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker),
  );

  return results;
}
