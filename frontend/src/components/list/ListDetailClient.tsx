"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Globe, Link2, Lock, Pencil, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsHeader } from "@/components/SettingsHeader";
import LoginDrawer from "@/components/LoginDrawer";
import PlaceSheetHost from "@/components/map/PlaceSheetHost";
import type { PlaceDetail } from "@/components/PlaceSheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  isValidListLinkUrl,
  ListFormFields,
  type ListFormValue,
} from "@/components/list/ListFormFields";
import { errorMessage } from "@/lib/api-client";
import { useBackLink } from "@/lib/use-back-link";
import { ListVisibility } from "@/generated/prisma/enums";
import type { MapProvider, PlaceListDTO } from "@/lib/types";
import type { FocusRequest, MapMarker } from "@/lib/map/types";

/** A refusal from the share route, whose message is already user-facing. */
class ShareFailed extends Error {}

const VISIBILITY_LABEL: Record<ListVisibility, string> = {
  [ListVisibility.PRIVATE]: "비공개",
  [ListVisibility.LINK]: "일부 공개",
  [ListVisibility.PUBLIC]: "전체 공개",
};

const VISIBILITY_ICON = {
  [ListVisibility.PRIVATE]: Lock,
  [ListVisibility.LINK]: Link2,
  [ListVisibility.PUBLIC]: Globe,
} as const;

/**
 * One list on a map, with its places below — the design's list detail.
 *
 * Shared by the owner's `/lists/<seq>` and the public `/u/<memberId>/<seq>`,
 * with `owner` switching the edit/delete controls off rather than a second
 * component existing. The reason is the one PlaceSheetHost and PostGrid record:
 * the two views differ by a handful of buttons but agree on every piece of
 * map/marker/focus wiring, and a copy is where that wiring quietly diverges.
 *
 * `sharable` is a boolean, not a URL: the share address does not exist until
 * the owner presses 공유, because that press is what mints the token. Rendering
 * a link into the page would publish a 일부 공개 list before anyone shared it.
 */
export default function ListDetailClient({
  list,
  mapProvider,
  owner,
  viewerSignedIn,
  sharable,
  backHref,
}: {
  list: PlaceListDTO;
  mapProvider: MapProvider;
  /** Renders 편집/삭제 and 공유 — the controls that write to *this* list. */
  owner: boolean;
  /**
   * Whether the person looking at the page has an account, which is a
   * different question from whether they own this list and must not be
   * conflated with it.
   *
   * The place sheet's star saves the tapped place into the *viewer's* own
   * lists, so on a shared list it is exactly the useful action: someone
   * browsing a friend's public list wants to keep a place from it. Passing
   * `owner` here (as this first did) left the star inert for every visitor on
   * a shared page — it rendered, absorbed the tap, and did nothing.
   */
  viewerSignedIn: boolean;
  /**
   * Whether 공유 should be offered — i.e. the viewer owns the list and its
   * visibility is not PRIVATE.
   *
   * A boolean rather than a ready-made URL, because the URL does not exist
   * until the button is pressed: the press is what mints the share token. See
   * `share()` below.
   */
  sharable: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { onBackClick } = useBackLink();
  const [editing, setEditing] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ListFormValue>({
    name: list.name,
    color: list.color,
    description: list.description ?? "",
    linkUrl: list.linkUrl ?? "",
    visibility: list.visibility,
  });

  const markers = useMemo<MapMarker[]>(
    () =>
      list.places.map((place) => ({
        key: String(place.id),
        placeId: place.id,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        category: place.category,
      })),
    [list.places],
  );

  const placeDetails = useMemo(
    () =>
      new Map<number, PlaceDetail>(
        // No sources: a list is a set of places the member chose, not a set of
        // posts. The sheet's communal fetch still fills in every post that
        // names the pin, which is the right answer here too — it just is not
        // seeded from this page's own data.
        list.places.map((place) => [place.id, { place, sources: [] }]),
      ),
    [list.places],
  );

  /**
   * Frames every pin on arrival, seeded into initial state so the camera is
   * right on the first paint — the same reason PostMapClient seeds its own.
   * Never reassigned: a marker tap deliberately does not move the camera.
   */
  const [focusRequest] = useState<FocusRequest | null>(() =>
    list.places.length > 0
      ? { placeIds: list.places.map((place) => place.id), nonce: 0 }
      : null,
  );

  async function saveEdit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/lists/${list.seq}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          color: form.color,
          description: form.description || null,
          // Trimmed to match `isValidListLinkUrl`, which ignores surrounding
          // whitespace: a whitespace-only value would otherwise pass the button
          // gate and still be a non-empty string the route rejects.
          linkUrl: form.linkUrl.trim() || null,
          visibility: form.visibility,
        }),
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "수정하지 못했습니다."));
      }
      setEditing(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "수정하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/lists/${list.seq}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "삭제하지 못했습니다."));
      }
      // replace() rather than push(): the deleted list's URL must not be a back
      // destination, and refresh() first so /lists is rebuilt without it.
      router.refresh();
      router.replace("/lists");
      toast.success("리스트를 삭제했어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했습니다.");
      setBusy(false);
    }
  }

  async function share() {
    if (!sharable) return;
    try {
      // Ask the server for the link *now* rather than rendering one into the
      // page. Pressing this button is what mints the token, and therefore what
      // makes a 일부 공개 list reachable at all — a URL computed at render time
      // would have published the list before anyone pressed anything, which is
      // exactly the rule this flow exists to keep.
      const res = await fetch(`/api/lists/${list.seq}/share`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new ShareFailed(await errorMessage(res, "공유할 수 없습니다."));
      }
      const { url: shareUrl } = (await res.json()) as { url: string };

      // The Web Share sheet where the platform has one — this app is used from
      // the iOS home screen, where it is the native affordance — and the
      // clipboard elsewhere. `canShare` is not checked: it is for *payloads*
      // (files), and a plain url/title is always shareable where `share` exists.
      if (navigator.share) {
        await navigator.share({ title: list.name, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      toast.success("링크를 복사했습니다.");
    } catch (error) {
      // AbortError is the user dismissing the share sheet, which is not a
      // failure and must not raise a toast.
      if (error instanceof DOMException && error.name === "AbortError") return;
      // A refusal from the server carries its own Korean message (a private
      // list, a list that is not the caller's); anything else is the browser's
      // share/clipboard call failing, where naming the fallback is the useful
      // thing to say.
      toast.error(
        error instanceof ShareFailed
          ? error.message
          : "공유할 수 없습니다. 주소를 직접 복사해 주세요.",
      );
    }
  }

  const VisibilityIcon = VISIBILITY_ICON[list.visibility];

  return (
    // h-dvh, not min-h-screen: this screen must not scroll as a whole (the map
    // owns its half), and 100vh resolves against iOS Safari's large viewport,
    // putting the bottom of the map under the browser chrome.
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <SettingsHeader
        href={backHref}
        ariaLabel="뒤로"
        title={list.name}
        onBackClick={onBackClick}
      />

      {/* `min-h-0` is load-bearing: the provider containers are `h-full w-full`
          and a flex child defaults to `min-height: auto`, so without it the map
          overflows the column instead of shrinking to it. */}
      <div className="relative min-h-0 flex-1">
        <PlaceSheetHost
          markers={markers}
          placeDetails={placeDetails}
          mapProvider={mapProvider}
          focusRequest={focusRequest}
          // The viewer's own session, not `owner`: the star saves into *their*
          // lists, which is the useful action on someone else's shared list.
          signedIn={viewerSignedIn}
          onRequireLogin={() => setLoginOpen(true)}
        />
      </div>

      <section className="max-h-[45dvh] shrink-0 overflow-y-auto border-t bg-background">
        <div className="flex items-start gap-3 p-5">
          <span
            aria-hidden
            className="size-11 shrink-0 rounded-full"
            style={{ backgroundColor: list.color }}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="truncate text-xl font-semibold">{list.name}</h2>
            {list.description && (
              <p className="truncate text-sm text-muted-foreground">
                {list.description}
              </p>
            )}
            {list.linkUrl && (
              <a
                href={list.linkUrl}
                target="_blank"
                rel="noreferrer noopener nofollow"
                className="truncate text-sm text-primary underline-offset-2 hover:underline"
              >
                {list.linkUrl}
              </a>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="tabular-nums">{list.count}개</span>
              <span aria-hidden>·</span>
              <VisibilityIcon aria-hidden className="size-3" />
              {VISIBILITY_LABEL[list.visibility]}
            </p>
          </div>
        </div>

        {owner && (
          <div className="flex gap-2 px-5 pb-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(true)}
              className="rounded-full"
            >
              <Pencil aria-hidden />
              편집
            </Button>
            {/* Not offered on a private list: there is nothing to hand out,
                and the server refuses to mint a token for one. */}
            {sharable && (
              <Button
                type="button"
                variant="outline"
                onClick={share}
                className="rounded-full"
              >
                <Share2 aria-hidden />
                공유
              </Button>
            )}
            {!list.isDefault && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setConfirmingDelete(true)}
                aria-label="리스트 삭제"
                className="ml-auto rounded-full text-muted-foreground"
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
        )}

        {list.places.length === 0 ? (
          <p className="px-5 pb-8 text-sm text-muted-foreground">
            아직 저장한 장소가 없어요.
          </p>
        ) : (
          <ul className="border-t">
            {list.places.map((place) => (
              <li key={place.id} className="border-b px-5 py-4 last:border-b-0">
                <p className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{place.name}</span>
                  {place.category && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {place.category}
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {place.address}
                </p>
                {place.memo && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {place.memo}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent
          side="bottom"
          className="mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col gap-0 rounded-t-2xl p-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:top-[100dvh] data-[side=bottom]:bottom-auto data-[side=bottom]:-translate-y-full data-[side=bottom]:data-ending-style:translate-y-0 data-[side=bottom]:data-starting-style:translate-y-0 sm:rounded-2xl"
        >
          <SheetHeader className="border-b p-5">
            <SheetTitle className="text-lg">리스트 편집</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <ListFormFields
              value={form}
              onChange={setForm}
              // The implicit "내 장소" keeps its name and stays private. The
              // server refuses both edits and so does a database CHECK; these
              // flags are the affordance, never the enforcement.
              lockName={list.isDefault}
              lockVisibility={list.isDefault}
            />
          </div>
          <div className="border-t p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <Button
              type="button"
              onClick={saveEdit}
              disabled={
                busy ||
                form.name.trim().length === 0 ||
                !isValidListLinkUrl(form.linkUrl)
              }
              className="h-13 w-full text-base"
            >
              {busy ? "저장 중…" : "완료"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>리스트를 삭제할까요?</AlertDialogTitle>
            {/* Deliberately does not promise erasure: the row and the notes on
                its entries are kept, exactly as a deleted link's memos are.
                See AGENTS.md on never wording a soft delete as "모두 삭제". */}
            <AlertDialogDescription>
              {list.name} 리스트가 목록에서 사라지고 이 주소도 열리지 않게 돼요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={busy}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Only reachable from the place sheet's star, and only when the viewer
          has no session — the same "meet the drawer, not a 401" rule the home
          map follows. `redirectTo` is this page so a visitor who signs in to
          save a place lands back on the list they were reading. */}
      <LoginDrawer
        open={loginOpen}
        onOpenChange={setLoginOpen}
        redirectTo={pathname}
      />
    </div>
  );
}
