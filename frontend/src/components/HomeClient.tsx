"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Menu, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import PlaceSheetHost from "@/components/map/PlaceSheetHost";
import CaptionPrompt from "@/components/CaptionPrompt";
import AppDrawer from "@/components/AppDrawer";
import LoginDrawer, { loginErrorMessage } from "@/components/LoginDrawer";
import UrlSheet from "@/components/UrlSheet";
import { type PlaceDetail } from "@/components/PlaceSheet";
import type {
  IngestedPost,
  IngestEvent,
  IngestResponse,
  IngestStage,
  ProfileDTO,
  SavedPostDTO,
} from "@/lib/types";
import type { FocusRequest, MapMarker } from "@/lib/map/types";
import { cn } from "@/lib/utils";

type Props = {
  initialPosts: SavedPostDTO[];
  profile: ProfileDTO;
  signedIn: boolean;
};

/**
 * Marks a pin that exists only until POST /api/posts answers. Prefixed so it
 * can never equal a saved pin's key — `markers` keys on `key`, so a collision
 * would let a pending pin shadow a saved one.
 *
 * A saved pin's key is `String(place.id)`, i.e. bare decimal digits since
 * Place.id became an int in 20260825. That is what the prefix separates these
 * from, and it is why MapMarker.key is a string at all: with both kinds sharing
 * one numeric id space there would be nowhere to put this mark. The generation
 * number after it distinguishes concurrent saves, so each clears only its own.
 */
const PENDING_MARKER_PREFIX = "pending:";

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? fallback;
}

/**
 * What the save button says while the pipeline runs.
 *
 * Named for what the user is waiting on rather than for the implementation —
 * "장소 찾는 중" not "LLM 추출 중". The geocoding count is shown only when
 * there is more than one place: "1/1" reads as machinery, and a single place
 * resolves fast enough that the number never settles anywhere legible.
 *
 * `idle` is what the button says when no stage is in flight, and the two
 * callers need different words for it: the URL sheet has not read anything yet
 * ("읽는 중…"), while the caption prompt is submitting a caption the user just
 * pasted ("저장 중…"). It covers the first moments of a request and the save
 * step after ingest, neither of which reports progress.
 */
function stageLabel(stage: IngestStage | null, idle: string): string {
  if (!stage) return idle;
  switch (stage.stage) {
    case "fetching":
      return "링크 읽는 중…";
    case "extracting":
      return "장소 찾는 중…";
    case "geocoding":
      return stage.total > 1
        ? `지도에서 확인 중… (${stage.done}/${stage.total})`
        : "지도에서 확인 중…";
  }
}

/**
 * How full the sheet's progress bar is, 0–100, for the stage the stream
 * reports. The scale is the Base UI progress primitive's, not a fraction.
 *
 * The weights are not guesses at wall-clock time — nothing here can predict a
 * model call — they are the ordering the user perceives, spaced so the bar
 * always has somewhere left to go. What makes the bar worth drawing at all is
 * `geocoding`: it is both the longest stage and the only one that streams a
 * real `done/total`, so the largest slice is the one carrying true progress.
 *
 * It deliberately never reaches 100. The stream's last event is the final
 * geocode, but the request is not over then — `POST /api/posts` still has to
 * run, and a bar sitting full while the button still says 저장 중 would be
 * claiming something finished that has not. The bar disappearing with the
 * sheet is what signals completion.
 *
 * `null` while idle, which is also how `IngestProgressBar` knows to drop its
 * no-going-backwards latch so a retry can start from empty again.
 *
 * Gated on `busy` rather than on `stage` alone, and the two are not the same:
 * `stage` is null for the whole window between pressing 저장 and the stream's
 * first event — the very moment the bar most needs to be on screen — and it is
 * cleared again while `POST /api/posts` runs on the caption-prompt path. Both
 * of those are still a wait, so they render an empty bar rather than no bar.
 */
function stageProgress(
  stage: IngestStage | null,
  busy: boolean,
): number | null {
  if (!busy) return null;
  if (!stage) return 0;
  switch (stage.stage) {
    case "fetching":
      return 15;
    case "extracting":
      return 40;
    case "geocoding":
      // total is 0 when the extraction found nothing to look up; the run is
      // about to end in an error, and 0/0 would be NaN in the width.
      return stage.total > 0 ? 40 + 50 * (stage.done / stage.total) : 40;
  }
}

export default function HomeClient({ initialPosts, profile, signedIn }: Props) {
  const [posts, setPosts] = useState(initialPosts);
  /**
   * Which map the user is looking at. Seeded from the server row and owned by
   * the client from then on, exactly like `posts` above.
   *
   * It lives here rather than being read straight off `profile` because the
   * drawer's radio has to change *this* map, and a prop can only change by way
   * of the server. That round trip used to be `router.refresh()`, which re-runs
   * a force-dynamic page: a session lookup plus the user's entire bookmark tree
   * (a four-table join through `bookmarkInclude`) re-read and re-serialised so
   * that one enum string could come back. The cost scaled with how many links
   * the user had saved, for a value that has nothing to do with any of them.
   *
   * Holding it in state makes the swap immediate and leaves the PATCH to do
   * nothing but persist. Do not reintroduce a refresh on this path.
   *
   * Seeding from a prop is only safe because the member cannot change under
   * this mount: the page keys HomeClient on the member id, so logging in or out
   * remounts and re-seeds both this and `posts`. Changing the map provider does
   * not change that key, so the drawer's PATCH still costs no page re-render.
   */
  const [mapProvider, setMapProvider] = useState(profile.mapProvider);
  const [ingesting, setIngesting] = useState(false);
  // Which pipeline stage the in-flight ingest is on, for the save button's
  // label. Null while idle; the stream sets it before each stage begins.
  const [stage, setStage] = useState<IngestStage | null>(null);
  /**
   * Pins drawn before POST /api/posts has answered, so the sheet can close the
   * moment the user presses save instead of holding them through a second
   * round of geocoding.
   *
   * Safe to render from the ingest response even though the app never trusts
   * client coordinates elsewhere: these are display-only and are discarded the
   * instant `refreshPosts()` returns the server's own rows. Nothing derived
   * from them is ever sent back — `save()` still posts names and hints only.
   *
   * Ids are prefixed so they cannot collide with a real Place cuid, which
   * matters because `markers` keys on id and a collision would let a pending
   * pin hide a saved one.
   */
  const [pendingMarkers, setPendingMarkers] = useState<MapMarker[]>([]);
  /**
   * Identifies the save each pending pin belongs to.
   *
   * Needed because the fast-closing sheet makes concurrent saves easy — the
   * user can reopen the form and paste a second link while the first POST is
   * still running. Without ownership, whichever save finished first cleared
   * *every* pending pin, so the second link's pins vanished before it landed.
   */
  const saveGenerationRef = useRef(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Only set when the caption could not be fetched; saving needs the user to
  // paste it before there is any text to extract places from.
  const [captionNeeded, setCaptionNeeded] = useState<IngestResponse | null>(
    null,
  );
  // The request drives the camera; the id it carries drives the highlight.
  // A bare id could not express "focus this again" after the user pans away,
  // because React skips the re-render when state is unchanged.
  const router = useRouter();
  const searchParams = useSearchParams();
  // Moves the camera to a place on arrival. **No screen in the app produces
  // this any more** — the place cards on /links/[id] used to send the user here
  // and now go to /links/[id]/map, which draws that post's pins alone instead
  // of burying them among every saved link. It is kept because the URL is
  // shareable and may already be bookmarked, so do not go looking for the
  // in-app caller; there isn't one.
  //
  // Seeding the initial state from it (rather than setting it in an effect)
  // gets the pin centred on the very first paint, with no visible jump.
  // Comma-separated, because the request can name a whole post's places at
  // once ("이 게시글의 6곳 보기") and not just one pin.
  const requestedPlace = searchParams.get("place");
  // Never reassigned: a marker click deliberately does not move the camera (see
  // handleMarkerClick), so ?place= on arrival is the only thing that focuses.
  const [focusRequest] = useState<FocusRequest | null>(() => {
    // Converted, not passed through. `placeIds` holds numbers because
    // useMarkerLookup matches with ===, so a string "12" straight out of the
    // query string would match no marker — and the pan effects treat "no
    // targets" as "nothing to do", so the camera would silently never move
    // instead of failing loudly. Junk segments are dropped rather than kept as
    // NaN, which would do the same thing one step later.
    const ids = (requestedPlace ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((id) => Number.isInteger(id) && id >= 1);
    return ids.length > 0 ? { placeIds: ids, nonce: 0 } : null;
  });

  // A failed OAuth attempt comes back here as ?auth=login&error=<slug>. It is
  // read once into initial state and then stripped from the URL below, so a
  // refresh does not reopen a drawer the user already dismissed. The
  // needs-a-phone-number case does not land here at all — it goes to
  // /verify-phone.
  const authParam = searchParams.get("auth");
  const [loginOpen, setLoginOpen] = useState(authParam !== null);
  const [loginError] = useState(() =>
    loginErrorMessage(searchParams.get("error")),
  );

  // Strip the consumed params so a refresh or a back-navigation does not yank
  // the map back to a pin the user has since panned away from, or reopen the
  // login drawer. This is a URL side effect only — the focus and the drawer's
  // initial state above already happened.
  useEffect(() => {
    if (requestedPlace || authParam) router.replace("/", { scroll: false });
  }, [requestedPlace, authParam, router]);

  const markers = useMemo<MapMarker[]>(() => {
    // Keyed by `key`, not `placeId`: pending pins have no place id, and this map
    // has to hold both kinds without one erasing the other.
    const byKey = new Map<string, MapMarker>();
    for (const post of posts) {
      for (const place of post.places) {
        // The same place saved from two posts is one pin.
        byKey.set(String(place.id), {
          key: String(place.id),
          placeId: place.id,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
          category: place.category,
        });
      }
    }
    // Appended after the saved rows, and deliberately not deduped against
    // them: a place the user already had stays keyed by its real id, so the
    // pending copy sits on top of it until the refresh drops it. Two pins at
    // one coordinate for a second or two is invisible; suppressing it would
    // need the name/address match the server has not made yet.
    for (const marker of pendingMarkers) byKey.set(marker.key, marker);
    return [...byKey.values()];
  }, [posts, pendingMarkers]);

  /**
   * Every saved place with the posts that named it, keyed by place id — what
   * the sheet renders when a pin is tapped.
   *
   * Built as one index rather than searched on each click because the
   * relation runs the wrong way for a lookup: `posts` holds places, so
   * answering "which posts mention this place" means scanning every post's
   * place list. A place saved from two different reels is one pin and gets
   * both of them listed.
   */
  const placeDetails = useMemo(() => {
    const byId = new Map<number, PlaceDetail>();
    for (const post of posts) {
      for (const place of post.places) {
        // The shared post id, not the bookmark id: the sheet merges these with
        // other members' sources for the same pin and dedupes across both, so
        // both halves have to identify a post by the same key.
        //
        // No `memo` here even though `place.memo` is right there — the merged
        // list includes posts this member never saved, which have no note of
        // theirs to show, so the sheet does not render one for anybody.
        const source = {
          postId: post.postId,
          sourceUrl: post.sourceUrl,
          platform: post.platform,
          title: post.title,
          thumbnail: post.thumbnail,
          author: post.author,
        };
        const existing = byId.get(place.id);
        if (existing) existing.sources.push(source);
        else byId.set(place.id, { place, sources: [source] });
      }
    }
    return byId;
  }, [posts]);

  /** Returns the refreshed list, or null when the refresh itself failed. */
  const refreshPosts = useCallback(async (): Promise<SavedPostDTO[] | null> => {
    // `no-store` is load-bearing, not hygiene. A bare GET with no
    // `Cache-Control` on the response is heuristically cacheable, so this call
    // could answer from the browser's HTTP cache with the list from *before*
    // the save that just ran. The row is written and the toast still fires
    // (`savedCount` falls back to the ingest count when it cannot find the new
    // row), but `setPosts` gets a list without it — and `clearOwnMarkers()`
    // then drops the optimistic pin because it is guarded only by `save()`
    // having resolved. Net: a successful save that leaves the map empty until
    // the next full page load, which reads the DB server-side and so was
    // always correct. The route sends `Cache-Control: no-store` too; both are
    // kept so neither side alone is what makes this work.
    const res = await fetch("/api/posts", { cache: "no-store" });
    if (!res.ok) {
      // Silently keeping a stale list would make the user re-save the post
      // they just saved.
      toast.error(await readError(res, "목록을 새로 불러오지 못했습니다."));
      return null;
    }
    const body = (await res.json()) as { posts: SavedPostDTO[] };
    setPosts(body.posts);
    return body.posts;
  }, []);

  const ingest = useCallback(
    async (targetUrl: string, manualCaption?: string) => {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          manualCaption
            ? { url: targetUrl, manualCaption }
            : { url: targetUrl },
        ),
      });

      // Only the pre-stream failures (401, malformed body) still arrive as a
      // status. Anything that goes wrong once the pipeline is running comes
      // back as an `error` event, because the status line is already sent.
      if (!res.ok) {
        throw new Error(await readError(res, "링크를 읽지 못했습니다."));
      }
      if (!res.body) throw new Error("링크를 읽지 못했습니다.");

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let result: IngestResponse | null = null;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (value) buffer += value;

          // A chunk boundary can fall mid-line, so only whole lines are
          // parsed; the remainder stays buffered for the next read.
          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;

            const event = JSON.parse(line) as IngestEvent;
            if (event.type === "progress") {
              setStage(event);
            } else if (event.type === "error") {
              throw new Error(event.error);
            } else {
              result = event.result;
            }
          }

          if (done) break;
        }
      } finally {
        // Releases the lock whether the loop finished, threw, or the caller
        // gave up — without this an aborted ingest leaves the body locked.
        reader.releaseLock();
      }

      // The stream ended without a result and without an error event, which
      // means it was cut off — a dropped connection or a function timeout.
      // Silently returning nothing here would look like a post with no places.
      if (!result) {
        throw new Error(
          "링크를 읽는 중 연결이 끊겼습니다. 잠시 후 다시 시도해 주세요.",
        );
      }

      return result;
    },
    [],
  );

  /**
   * Writes the post. The caller has already established there is at least one
   * matched place and has closed the sheet, so this only reports transport and
   * server failures — its rejection is what rolls the pending pins back.
   */
  const save = useCallback(
    async (result: IngestResponse) => {
      const places = result.candidates.filter((candidate) => candidate.matched);

      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post: {
            sourceUrl: result.post.sourceUrl,
            platform: result.post.platform,
            title: result.post.title,
            caption: result.post.caption,
            thumbnail: result.post.thumbnail,
            thumbnailSource: result.post.thumbnailSource,
            author: result.post.author,
            authorImage: result.post.authorImage,
            authorImageSource: result.post.authorImageSource,
          },
          // Only the search terms are sent; the server re-geocodes so a
          // request cannot write coordinates into the shared place table.
          places: places.map((place) => ({
            name: place.query,
            hint: place.hint,
          })),
        }),
      });

      if (!res.ok) {
        throw new Error(await readError(res, "저장하지 못했습니다."));
      }

      // An assertion, so it is not checked: keep it in step with
      // SavedPostDTO.id by hand. It was `string` until Bookmark.id became an
      // int (20260825), and leaving it stale would not have failed to compile —
      // the `post.id === id` match below would just have stopped matching, and
      // the count in the success toast would silently fall back to the ingest
      // number, which is exactly the silence that toast exists to end.
      const { id, reusedPost } = (await res.json()) as {
        id: number;
        reusedPost: boolean;
      };
      // Returned so the caller can count what the row actually holds. The
      // server re-geocodes, so its matched set can be smaller than the one
      // ingest reported — reporting the ingest count would recreate the
      // silence this toast exists to end, one round later.
      return { id, reusedPost, posts: await refreshPosts() };
    },
    [refreshPosts],
  );

  /**
   * Lets the failure toast's 다시 시도 re-run the whole flow. A ref rather than
   * naming `ingestAndSave` directly, because the callback would then have to
   * list itself as its own dependency.
   */
  const ingestAndSaveRef = useRef<
    | ((
        url: string,
        manualCaption?: string,
        fallbackPost?: IngestedPost,
      ) => Promise<void>)
    | null
  >(null);

  /**
   * Ingest and save are one user action now: a link either lands on the map or
   * reports why it could not, with the caption prompt as the only detour.
   *
   * Once ingest has resolved at least one place the user stops waiting — the
   * sheet closes, the pins go up, and the save finishes underneath.
   */
  const ingestAndSave = useCallback(
    async (
      targetUrl: string,
      manualCaption?: string,
      /**
       * Metadata to fall back on when the re-ingest returns nulls, used by the
       * failure toast's retry. `captionNeeded` normally carries this, but it is
       * cleared the moment the sheet closes — so a retry would otherwise post
       * `title: null`/`author: null` and wipe what the first pass found, which
       * POST /api/posts guards for the thumbnail only.
       */
      fallbackPost?: IngestedPost,
    ) => {
      setIngesting(true);
      setStage(null);
      try {
        const result = await ingest(targetUrl, manualCaption);
        // Cleared as soon as ingest is done, because the save that follows
        // reports no progress of its own: POST /api/posts re-geocodes every
        // place and can run for seconds, and leaving the last geocoding label
        // up would tell the user we are still doing something we finished.
        setStage(null);

        // Without a caption there is nothing to extract places from, so ask
        // for it instead of failing the save. The sheet steps aside so the
        // two dialogs are never stacked on top of each other.
        if (result.needsManualCaption) {
          setCaptionNeeded(result);
          setSheetOpen(false);
          return;
        }

        // The manual-caption retry skips the metadata fetch for a source
        // already known to be blocking, so its title/thumbnail/author come
        // back null. Saving those would wipe what the first pass found.
        //
        // For title and author this is the only guard there is. The thumbnail
        // is also defended server-side (POST /api/posts leaves the column
        // alone when null, because it may point at a blob we own), so keeping
        // it here is belt-and-braces — dropping it would just make the
        // expression asymmetric for no gain.
        // `fallbackPost` is the retry's copy of the same values; both are
        // checked because the first attempt has `captionNeeded` and the retry
        // has only what it was handed.
        const previous = captionNeeded?.post ?? fallbackPost;
        const merged = previous
          ? {
              ...result,
              post: {
                ...result.post,
                title: result.post.title ?? previous.title,
                thumbnail: result.post.thumbnail ?? previous.thumbnail,
                thumbnailSource:
                  result.post.thumbnailSource ?? previous.thumbnailSource,
                author: result.post.author ?? previous.author,
                authorImage: result.post.authorImage ?? previous.authorImage,
                authorImageSource:
                  result.post.authorImageSource ?? previous.authorImageSource,
              },
            }
          : result;

        // Nothing to save and nothing to draw — report it against the still
        // open sheet rather than closing onto an empty map. Thrown so the
        // catch below is the single place that renders a failure.
        const matched = merged.candidates.filter(
          (candidate) => candidate.matched,
        );
        if (matched.length === 0) {
          // A failed lookup is not the same as a place that isn't on the map;
          // saying "not found" would send the user off to fix a correct link.
          throw new Error(
            merged.candidates.some((candidate) => candidate.lookupFailed)
              ? "장소 검색에 일시적으로 실패했습니다. 잠시 후 다시 시도해 주세요."
              : "이 게시글에서 지도에 표시할 장소를 찾지 못했습니다.",
          );
        }

        // From here the user is done waiting. The sheet closes, the pins the
        // ingest already resolved go straight onto the map, and POST
        // /api/posts finishes underneath — it re-geocodes every place, so it
        // is seconds of work whose outcome the user cannot act on anyway.
        //
        // Coordinates are used for display only; `save()` still sends names
        // and hints, so the "never trust client coordinates" rule is intact.
        const generation = ++saveGenerationRef.current;
        const optimistic = matched.map<MapMarker>((candidate, index) => ({
          key: `${PENDING_MARKER_PREFIX}${generation}:${merged.post.sourceUrl}#${index}`,
          // No row exists yet, so there is no Place id to carry. Null is what
          // makes this pin non-clickable — there are no sources to open.
          placeId: null,
          name: candidate.name,
          lat: candidate.lat,
          lng: candidate.lng,
          // The ingest already resolved this, so the optimistic pin carries the
          // same label the saved one will — it must not change shape when the
          // refresh swaps it out.
          category: candidate.category,
        }));

        setCaptionNeeded(null);
        setSheetOpen(false);
        // Appended rather than replacing, so a save still in flight keeps its
        // pins while this one draws its own.
        setPendingMarkers((prev) => [...prev, ...optimistic]);
        setIngesting(false);
        setStage(null);

        /** Drops only this save's pins, leaving any concurrent save's alone. */
        const clearOwnMarkers = () =>
          setPendingMarkers((prev) =>
            prev.filter(
              (marker) =>
                !marker.key.startsWith(
                  `${PENDING_MARKER_PREFIX}${generation}:`,
                ),
            ),
          );

        try {
          const { id, reusedPost, posts: refreshed } = await save(merged);
          // Dropped only after refreshPosts() inside save() has returned, so
          // the real rows are already in `posts` — clearing any earlier would
          // blink the pins off the map and back on.
          clearOwnMarkers();

          // Counted from the saved row, not from the ingest result. The server
          // re-geocodes every name and keeps only what it could match, and a
          // lookup that succeeded during ingest can fail on that second round
          // (failures are deliberately not cached) — so the ingest count would
          // sometimes promise more than the row holds. Falls back to the
          // ingest count only when the refresh itself failed, which already
          // reported its own error.
          const saved = refreshed?.find((post) => post.id === id);
          const savedCount = saved?.places.length ?? matched.length;

          // Only counted when this request actually geocoded the places being
          // reported. For a link somebody already saved, the row carries the
          // *shared* post's place list and this run resolved nothing — the
          // difference between the two numbers would then say nothing about a
          // failed lookup, and "N곳은 지도에서 찾지 못했어요" would be a claim
          // about a round that never ran. (It can also come out negative there,
          // when the first save found more places than this caption did.)
          const missing = reusedPost
            ? 0
            : merged.candidates.length - savedCount;
          toast.success(
            missing > 0
              ? `${savedCount}곳을 저장했어요. ${missing}곳은 지도에서 찾지 못했어요.`
              : `${savedCount}곳을 지도에 저장했어요.`,
          );
        } catch (cause) {
          // The pins came back off the map, so the toast is the only thing
          // left saying what happened — and it carries the retry, since the
          // sheet the user would have retried from is already closed.
          clearOwnMarkers();
          const message =
            cause instanceof Error ? cause.message : "저장하지 못했습니다.";
          toast.error(message, {
            action: {
              label: "다시 시도",
              // merged.post, not result.post: the retry re-ingests and gets
              // nulls back on the manual-caption path, so it needs the values
              // this attempt had already recovered.
              onClick: () =>
                void ingestAndSaveRef.current?.(
                  targetUrl,
                  manualCaption,
                  merged.post,
                ),
            },
          });
        }
        return;
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "저장하지 못했습니다.";
        toast.error(message);
      } finally {
        // Both already cleared on the path that closes the sheet early; this
        // covers the ingest failures and the caption detour, which leave the
        // sheet up.
        setIngesting(false);
        // Cleared here rather than on success only, so a failed attempt does
        // not leave the button labelled with the stage it died on.
        setStage(null);
      }
    },
    [captionNeeded, ingest, save],
  );

  // Synced in an effect rather than assigned during render: the ref exists
  // only so the failure toast's retry can call back into the latest version of
  // this callback without the callback depending on itself.
  useEffect(() => {
    ingestAndSaveRef.current = ingestAndSave;
  }, [ingestAndSave]);

  return (
    // The map fills the viewport; every other control floats above it.
    //
    // h-dvh rather than inset-0: on iOS Safari a fixed box resolves its bottom
    // against the *large* viewport, the one that assumes the toolbars are
    // retracted. The toolbars are usually not retracted, so `bottom-0` sits a
    // couple hundred px below the last visible row and anything anchored to it
    // — the + button — is drawn underneath the browser chrome. The dynamic
    // viewport unit tracks the height actually on screen instead.
    //
    // Only the vertical axis needed changing, hence w-full and not w-screen:
    // 100vw includes the classic scrollbar gutter, so it renders 15px wider
    // than inset-0 wherever the scrollbar takes layout space, pushing the
    // right-hand control under it. On a fixed box width:100% resolves against
    // the same containing block inset-0 used.
    <div className="fixed top-0 left-0 h-dvh w-full">
      {/* The map, the pin selection and the place card all live in
          PlaceSheetHost — /links/[id]/map renders the same surface, and the
          sources fetch and merge inside it are correctness mechanisms rather
          than wiring, so a second copy would drift silently. The floating
          controls come back as children because one of them has to hide while
          the card is up (see below). */}
      <PlaceSheetHost
        markers={markers}
        placeDetails={placeDetails}
        // The live state, not `profile.mapProvider`: the drawer's radio changes
        // the map in the same render, so reading the seed here would leave the
        // external map-app buttons pointing at the previous provider until a
        // server round trip that this path deliberately does not make.
        mapProvider={mapProvider}
        focusRequest={focusRequest}
        // Stood down while the URL sheet or the caption prompt is up: those are
        // modal and would trap focus over a non-modal sheet the user can no
        // longer reach or dismiss. The selection survives, so closing them
        // brings the place card back.
        suppressed={sheetOpen || captionNeeded !== null}
        // The place card's favourite star follows the same rule the two
        // floating controls below already do: signed out it opens the login
        // drawer rather than firing a request that can only 401.
        signedIn={signedIn}
        onRequireLogin={() => setLoginOpen(true)}
      >
        {(selectedPlace) => (
          <>
            {/* Both controls float over the map, so they carry their own surface
              colour and shadow rather than the transparent ghost/outline the map
              would show straight through. */}
            {/* Both controls ask for a login before doing anything that needs one,
              so a signed-out visitor meets the drawer rather than a 401. */}
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() =>
                signedIn ? setDrawerOpen(true) : setLoginOpen(true)
              }
              aria-label={signedIn ? "메뉴 열기" : "로그인"}
              className="absolute top-4 left-4 z-30 h-11 w-11 rounded-full bg-background shadow-lg hover:bg-accent"
            >
              <Menu className="h-5 w-5" />
            </Button>

            <Button
              type="button"
              size="icon"
              onClick={() => {
                if (!signedIn) {
                  setLoginOpen(true);
                  return;
                }
                setSheetOpen(true);
              }}
              aria-label="링크 추가"
              // Hidden while a place card is up. The card is a bottom sheet and this
              // button sits inside its area, and z-index cannot resolve that: the
              // sheet is portaled to <body>, so it comes after this whole fixed
              // container in DOM order and paints over the button whatever z-30
              // says. Raising the button instead would leave it floating on top of
              // the card, which is not a control the card wants. Closing the card
              // brings it straight back.
              //
              // No env(safe-area-inset-*) here: the app never sets viewport-fit=cover,
              // so every inset resolves to 0 and the calc would be decoration. The
              // same is true of the insets already written into UrlSheet and
              // LoginDrawer — turning cover mode on activates all of them at once and
              // needs a pass on a notched device, so it is not bundled into this fix.
              className={cn(
                "absolute right-5 bottom-6 z-30 h-11 w-11 rounded-full shadow-lg",
                selectedPlace && "hidden",
              )}
            >
              <Plus className="h-7 w-7" />
            </Button>

            {/* Signed out there is no profile to render or settings to change, so
              the menu is replaced by the login drawer rather than shown empty. */}
            {signedIn && (
              <AppDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                profile={profile}
                mapProvider={mapProvider}
                onMapProviderChange={setMapProvider}
              />
            )}

            <LoginDrawer
              open={loginOpen}
              onOpenChange={setLoginOpen}
              redirectTo="/"
              initialError={loginError}
            />
          </>
        )}
      </PlaceSheetHost>

      {/* Always mounted, for the reason PlaceSheet is: `open` must go from an
          actual `false` to `true` for Base UI to have a transition to
          animate. A conditionally-mounted `{sheetOpen && <UrlSheet .../>}`
          starts every open already at `open`'s final value, so the sheet
          just appears instead of sliding up. */}
      <UrlSheet
        open={sheetOpen}
        busy={ingesting}
        busyLabel={stageLabel(stage, "읽는 중…")}
        progress={stageProgress(stage, ingesting)}
        onClose={() => setSheetOpen(false)}
        onSubmit={(targetUrl) => void ingestAndSave(targetUrl)}
      />

      {captionNeeded && (
        <CaptionPrompt
          post={captionNeeded.post}
          busy={ingesting}
          busyLabel={stageLabel(stage, "저장 중…")}
          progress={stageProgress(stage, ingesting)}
          onCancel={() => setCaptionNeeded(null)}
          onSubmit={(caption) =>
            ingestAndSave(captionNeeded.post.sourceUrl, caption)
          }
        />
      )}
    </div>
  );
}
