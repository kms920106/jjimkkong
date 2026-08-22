"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Menu, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import MapView from "@/components/map/MapView";
import CaptionPrompt from "@/components/CaptionPrompt";
import AppDrawer from "@/components/AppDrawer";
import LoginDrawer, { loginErrorMessage } from "@/components/LoginDrawer";
import UrlSheet from "@/components/UrlSheet";
import PlaceSheet, { type PlaceDetail } from "@/components/PlaceSheet";
import type {
  IngestResponse,
  PlaceSourceDTO,
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

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? fallback;
}

export default function HomeClient({ initialPosts, profile, signedIn }: Props) {
  const [posts, setPosts] = useState(initialPosts);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  // /links sends the user back here with ?place=<id> to move the camera.
  // Seeding the initial state from it (rather than setting it in an effect)
  // gets the pin centred on the very first paint, with no visible jump.
  // Comma-separated, because /links can ask for a whole post's places at once
  // ("이 게시글의 6곳 보기") and not just one pin.
  const requestedPlace = searchParams.get("place");
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(() => {
    const ids = (requestedPlace ?? "").split(",").filter(Boolean);
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

  // The pin whose sheet is open, or null. Held as an id rather than the
  // detail object so a refresh of `posts` — deleting the post from another
  // tab, re-saving the link — flows through to the open sheet instead of
  // leaving a snapshot of data that no longer exists.
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  // Every user's saved links for the currently open pin, fetched separately
  // from `posts` (which is scoped to the caller). Keyed by place id so a
  // stale response from a pin the user has since closed cannot land on the
  // wrong sheet.
  const [communalSources, setCommunalSources] = useState<{
    placeId: string;
    sources: PlaceSourceDTO[];
  } | null>(null);

  const requestFocus = useCallback((placeId: string) => {
    setFocusRequest((prev) => ({
      placeIds: [placeId],
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }, []);

  /**
   * A marker click does both: it opens the place's sheet and moves the camera
   * to the pin, the way tapping a pin on 네이버지도 does. Focusing without
   * opening the sheet was the old behaviour and said nothing about the place.
   */
  const handleMarkerClick = useCallback(
    (placeId: string) => {
      setSelectedPlaceId(placeId);
      requestFocus(placeId);
    },
    [requestFocus],
  );

  // Fetches the communal source list whenever the selected pin changes.
  // Un-scoped by design — the place row is already shared across users, so
  // this only reads what the shared map already implies. A stale in-flight
  // request from a pin the user has since left is discarded by checking the
  // placeId still matches the current selection when it resolves.
  useEffect(() => {
    if (!selectedPlaceId) return;
    let cancelled = false;
    fetch(`/api/places/${selectedPlaceId}/sources`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { sources: PlaceSourceDTO[] } | null) => {
        if (cancelled || !body) return;
        setCommunalSources({ placeId: selectedPlaceId, sources: body.sources });
      })
      .catch(() => {
        // Silent: PlaceSheet still has the caller's own sources from
        // `placeDetails` to fall back on.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlaceId]);

  // Strip the consumed params so a refresh or a back-navigation does not yank
  // the map back to a pin the user has since panned away from, or reopen the
  // login drawer. This is a URL side effect only — the focus and the drawer's
  // initial state above already happened.
  useEffect(() => {
    if (requestedPlace || authParam) router.replace("/", { scroll: false });
  }, [requestedPlace, authParam, router]);

  const markers = useMemo<MapMarker[]>(() => {
    const byId = new Map<string, MapMarker>();
    for (const post of posts) {
      for (const place of post.places) {
        // The same place saved from two posts is one pin.
        byId.set(place.id, {
          id: place.id,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
        });
      }
    }
    return [...byId.values()];
  }, [posts]);

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
    const byId = new Map<string, PlaceDetail>();
    for (const post of posts) {
      for (const place of post.places) {
        const source = {
          postId: post.id,
          sourceUrl: post.sourceUrl,
          platform: post.platform,
          title: post.title,
          thumbnail: post.thumbnail,
          author: post.author,
          // The memo belongs to this post's link to the place, not to the
          // shared place row, so it travels with the source.
          memo: place.memo,
        };
        const existing = byId.get(place.id);
        if (existing) existing.sources.push(source);
        else byId.set(place.id, { place, sources: [source] });
      }
    }
    return byId;
  }, [posts]);

  // Resolved through the index rather than stored, so a place that disappears
  // — its only post deleted — closes the sheet instead of showing stale data.
  const ownPlaceDetail = selectedPlaceId
    ? (placeDetails.get(selectedPlaceId) ?? null)
    : null;

  /**
   * What PlaceSheet actually renders: the caller's own sources (always
   * present, from `posts`) merged with every other user's sources for the
   * same pin (fetched separately, arrives a beat later). Deduped by
   * sourceUrl — the same post saved by two different users produces two
   * SavedPost rows and would otherwise list the same link twice.
   */
  const selectedPlace = useMemo<PlaceDetail | null>(() => {
    if (!ownPlaceDetail) return null;
    const bySourceUrl = new Map(
      ownPlaceDetail.sources.map((source) => [source.sourceUrl, source]),
    );
    if (communalSources && communalSources.placeId === ownPlaceDetail.place.id) {
      for (const source of communalSources.sources) {
        if (!bySourceUrl.has(source.sourceUrl)) {
          bySourceUrl.set(source.sourceUrl, source);
        }
      }
    }
    return { place: ownPlaceDetail.place, sources: [...bySourceUrl.values()] };
  }, [ownPlaceDetail, communalSources]);

  const refreshPosts = useCallback(async () => {
    const res = await fetch("/api/posts");
    if (!res.ok) {
      // Silently keeping a stale list would make the user re-save the post
      // they just saved.
      setError(await readError(res, "목록을 새로 불러오지 못했습니다."));
      return;
    }
    const body = (await res.json()) as { posts: SavedPostDTO[] };
    setPosts(body.posts);
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

      if (!res.ok) {
        throw new Error(await readError(res, "링크를 읽지 못했습니다."));
      }

      return (await res.json()) as IngestResponse;
    },
    [],
  );

  /** Saves every geocoded candidate; the user no longer picks a subset. */
  const save = useCallback(
    async (result: IngestResponse) => {
      const places = result.candidates.filter((candidate) => candidate.matched);

      if (places.length === 0) {
        // A failed lookup is not the same as a place that isn't on the map;
        // saying "not found" would send the user off to fix a correct link.
        throw new Error(
          result.candidates.some((candidate) => candidate.lookupFailed)
            ? "장소 검색에 일시적으로 실패했습니다. 잠시 후 다시 시도해 주세요."
            : "이 게시글에서 지도에 표시할 장소를 찾지 못했습니다.",
        );
      }

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
            author: result.post.author,
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

      setCaptionNeeded(null);
      setSheetOpen(false);
      await refreshPosts();
    },
    [refreshPosts],
  );

  /**
   * Ingest and save are one user action now: a link either lands on the map or
   * reports why it could not, with the caption prompt as the only detour.
   */
  const ingestAndSave = useCallback(
    async (targetUrl: string, manualCaption?: string) => {
      setIngesting(true);
      setError(null);
      try {
        const result = await ingest(targetUrl, manualCaption);

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
        await save(
          captionNeeded
            ? {
                ...result,
                post: {
                  ...result.post,
                  title: result.post.title ?? captionNeeded.post.title,
                  thumbnail:
                    result.post.thumbnail ?? captionNeeded.post.thumbnail,
                  author: result.post.author ?? captionNeeded.post.author,
                },
              }
            : result,
        );
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "저장하지 못했습니다.";
        setError(message);
        // Fired here rather than from an effect on `error`: two failures in a
        // row carry the same message, React bails out of the identical state
        // update, and an effect would never re-run — the second attempt would
        // report nothing at all. The overlays below render `error` inline, so
        // the toast is only for a failure with nothing else on screen.
        if (!sheetOpen && !captionNeeded) toast.error(message);
      } finally {
        setIngesting(false);
      }
    },
    [captionNeeded, ingest, save, sheetOpen],
  );

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
      <MapView
        provider={profile.mapProvider}
        markers={markers}
        onMarkerClick={handleMarkerClick}
        focusRequest={focusRequest}
      />

      {/* Both controls float over the map, so they carry their own surface
          colour and shadow rather than the transparent ghost/outline the map
          would show straight through. */}
      {/* Both controls ask for a login before doing anything that needs one,
          so a signed-out visitor meets the drawer rather than a 401. */}
      <Button
        type="button"
        variant="secondary"
        size="icon"
        onClick={() => (signedIn ? setDrawerOpen(true) : setLoginOpen(true))}
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
          setError(null);
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
          savedCount={posts.length}
        />
      )}

      <LoginDrawer
        open={loginOpen}
        onOpenChange={setLoginOpen}
        redirectTo="/"
        initialError={loginError}
      />

      {/* Stood down while the URL sheet or the caption prompt is up: those are
          modal and would trap focus over a non-modal sheet the user can no
          longer reach or dismiss. The selection survives, so closing them
          brings the place card back. */}
      {selectedPlace && !sheetOpen && !captionNeeded && (
        <PlaceSheet
          // Keyed by place so switching pins remounts rather than animating
          // one card's contents into another's while the old scroll position
          // stays put.
          key={selectedPlace.place.id}
          detail={selectedPlace}
          mapProvider={profile.mapProvider}
          onClose={() => setSelectedPlaceId(null)}
        />
      )}

      {sheetOpen && (
        <UrlSheet
          busy={ingesting}
          error={error}
          onClose={() => setSheetOpen(false)}
          onSubmit={(targetUrl) => void ingestAndSave(targetUrl)}
        />
      )}

      {captionNeeded && (
        <CaptionPrompt
          post={captionNeeded.post}
          busy={ingesting}
          // Rendered inline here, which is why the toast effect above stays
          // quiet while this prompt is open.
          error={error}
          onCancel={() => {
            setCaptionNeeded(null);
            setError(null);
          }}
          onSubmit={(caption) =>
            ingestAndSave(captionNeeded.post.sourceUrl, caption)
          }
        />
      )}
    </div>
  );
}
