"use client";

import { useEffect, useState } from "react";
import { Check, Globe, Link2, Lock, Plus, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { errorMessage } from "@/lib/api-client";
import {
  EMPTY_LIST_FORM,
  isValidListLinkUrl,
  ListFormFields,
  type ListFormValue,
} from "@/components/list/ListFormFields";
import type {
  ListVisibility,
  PlaceListPickerDTO,
  PlaceListSummaryDTO,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The "save to a list" sheet: pick which of the member's lists hold this place,
 * or make a new one.
 *
 * Modal, unlike PlaceSheet — this one asks a question and the answer needs a
 * confirm press, so trapping focus and dimming the map is right. PlaceSheet is
 * non-modal precisely because it does not.
 *
 * The selection is applied on 저장 rather than per-tap. Each tap would otherwise
 * be its own round trip, and a member fixing a mis-tap would have written twice
 * — which for the *removal* half means marking an entry removed and then
 * reviving it, churning the memo's row for nothing.
 */
export default function SavePlaceSheet({
  placeId,
  placeName,
  placeCategory,
  placeAddress,
  open,
  onOpenChange,
  onSaved,
}: {
  placeId: number;
  placeName: string;
  placeCategory: string | null;
  placeAddress: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lets the caller refresh its star without re-fetching the picker itself. */
  onSaved: (containing: number[]) => void;
}) {
  const [lists, setLists] = useState<PlaceListSummaryDTO[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  /**
   * The place the loaded lists belong to, or null while a fetch is out.
   *
   * "Loading" is derived from this rather than held as its own flag, which is
   * what keeps the reset out of an effect: opening the sheet for a different
   * place makes `loadedFor !== placeId` true on the very next render, so the
   * spinner shows without a `setLoading(true)` that lint's
   * `react-hooks/set-state-in-effect` correctly rejects — and without the frame
   * of stale rows that setting it in an effect would paint first.
   */
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const loading = loadedFor !== placeId;

  // The set the sheet opened with, so 저장 can work out what changed. Without it
  // the submit would have to re-add every checked list on every press, which is
  // harmless for the upsert but would revive `removedAt` rows the member did
  // not touch.
  const [initial, setInitial] = useState<Set<number>>(new Set());

  // Refetched whenever the sheet opens rather than once on mount: the member
  // may have created a list on another screen since, and a stale picker would
  // silently omit it.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/places/${placeId}/lists`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: PlaceListPickerDTO | null) => {
        if (cancelled || !body) return;
        setLists(body.lists);
        setSelected(new Set(body.containing));
        setInitial(new Set(body.containing));
        setLoadedFor(placeId);
      })
      .catch(() => {
        // Marked loaded so the spinner gives way to the empty state rather than
        // spinning forever. The member can still create a list from here, which
        // is the useful half of the sheet when the read failed.
        if (!cancelled) setLoadedFor(placeId);
      });
    return () => {
      cancelled = true;
    };
  }, [open, placeId]);

  function toggle(seq: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const added = [...selected].filter((seq) => !initial.has(seq));
      const removed = [...initial].filter((seq) => !selected.has(seq));

      // Sequential rather than Promise.all: each add allocates MAX+1 inside its
      // own transaction, and firing them together makes those races contend for
      // nothing — a member checks two or three boxes, not twenty.
      for (const seq of added) {
        const res = await fetch(`/api/lists/${seq}/places`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ placeId }),
        });
        if (!res.ok) {
          throw new Error(await errorMessage(res, "저장하지 못했습니다."));
        }
      }
      for (const seq of removed) {
        const res = await fetch(`/api/lists/${seq}/places/${placeId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          throw new Error(await errorMessage(res, "삭제하지 못했습니다."));
        }
      }

      onSaved([...selected]);
      onOpenChange(false);
      toast.success(
        selected.size === 0
          ? "저장을 해제했어요."
          : `${selected.size}개 리스트에 저장했어요.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          // Anchored to the dynamic viewport like every other bottom sheet
          // here: on iOS the layout viewport ignores the browser chrome, so the
          // primitive's bottom-0 lands underneath it.
          //
          // `min-h` as well as `max-h`, and the floor is what matters: this
          // sheet opens *over* PlaceSheet (65dvh), and 80dvh is only a cap — a
          // member with two lists got a sheet shorter than the place card
          // behind it, so the card's edges stuck out around the thing that was
          // supposed to have replaced it. 72dvh clears 65dvh with enough margin
          // to read as deliberate rather than as a near-miss.
          className="mx-auto flex max-h-[80dvh] min-h-[72dvh] w-full max-w-lg flex-col gap-0 rounded-t-2xl p-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:top-[100dvh] data-[side=bottom]:bottom-auto data-[side=bottom]:-translate-y-full data-[side=bottom]:data-ending-style:translate-y-0 data-[side=bottom]:data-starting-style:translate-y-0 sm:rounded-2xl"
          // Darker and blurrier than the app default, which is tuned for a
          // sheet over a static page. This one covers the map *and* the place
          // card, and at the default `bg-black/10 backdrop-blur-xs` the card
          // behind stayed legible enough to compete with the picker for
          // attention.
          overlayClassName="bg-black/25 supports-backdrop-filter:backdrop-blur-sm"
          showCloseButton={false}
        >
          <SheetHeader className="flex-row items-start justify-between gap-3 border-b p-5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <SheetTitle className="truncate text-base">
                {placeName}
              </SheetTitle>
              <p className="truncate text-sm text-muted-foreground">
                {[placeCategory, placeAddress].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              aria-label="닫기"
              className="shrink-0 rounded-full text-muted-foreground"
            >
              <X aria-hidden />
            </Button>
          </SheetHeader>

          {/* `min-h-0` is load-bearing on a flex-col child that scrolls: the
              default `min-height: auto` refuses to shrink, so without it this
              region grows past the sheet's max-height instead of scrolling. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-3 border-b py-4 text-left"
            >
              <span className="flex size-9 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground">
                <Plus aria-hidden className="size-4" />
              </span>
              <span className="text-muted-foreground">새 리스트 만들기</span>
            </button>

            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                불러오는 중…
              </p>
            ) : lists.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                아직 리스트가 없어요. 새로 만들어 저장해 보세요.
              </p>
            ) : (
              <ul>
                {lists.map((list) => {
                  const checked = selected.has(list.seq);
                  return (
                    <li key={list.seq}>
                      {/* A button with `aria-pressed` rather than a checkbox:
                          the whole row is the target, and a real checkbox
                          inside a clickable row gives screen readers two
                          controls for one action. */}
                      <button
                        type="button"
                        onClick={() => toggle(list.seq)}
                        aria-pressed={checked}
                        className="flex w-full items-center gap-3 border-b py-4 text-left last:border-b-0"
                      >
                        <ListAvatar
                          color={list.color}
                          visibility={list.visibility}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {list.name}{" "}
                          <span className="text-muted-foreground tabular-nums">
                            {list.count}
                          </span>
                        </span>
                        {/* The check circle is drawn in both states rather
                            than only when checked. An outline that appears
                            out of nowhere on tap reads as the row having
                            sprouted a new control; a ring that fills in place
                            reads as the answer to a question the row was
                            already asking. */}
                        <span
                          aria-hidden
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-full border transition",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input text-muted-foreground/40",
                          )}
                        >
                          <Check className="size-4" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <Button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="h-13 w-full text-base"
            >
              {saving ? "저장 중…" : "저장"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <CreateListSheet
        open={creating}
        onOpenChange={setCreating}
        onCreated={(list) => {
          // Prepended and pre-checked: the member made this list in order to
          // put the place in it, so leaving it unchecked would make the next
          // tap a chore they did not ask for.
          setLists((current) => [list, ...current]);
          setSelected((current) => new Set(current).add(list.seq));
        }}
      />
    </>
  );
}

/**
 * A list's colour dot, carrying a star and a corner badge for its visibility.
 *
 * The badge is the only place in the picker that says who can see a list, and
 * it earns the corner: the member is choosing where to file a place, and
 * "이건 전체 공개였지" is exactly the thing worth knowing before the tap rather
 * than after. Three glyphs for the three enum values, so PRIVATE is not the
 * silent default that a badge-only-when-shared design would make it.
 */
function ListAvatar({
  color,
  visibility,
}: {
  color: string;
  visibility: ListVisibility;
}) {
  const Badge =
    visibility === "PUBLIC" ? Globe : visibility === "LINK" ? Link2 : Lock;

  return (
    <span aria-hidden className="relative size-9 shrink-0">
      <span
        className="flex size-9 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: color }}
      >
        <Star className="size-4 fill-current" />
      </span>
      {/* `border-background` rather than a gap: the badge overlaps the dot, and
          a ring in the sheet's own colour is what keeps its edge legible
          against whichever palette colour the member picked. */}
      <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full border-2 border-background bg-muted-foreground text-background">
        <Badge className="size-2.5" strokeWidth={3} />
      </span>
    </span>
  );
}

/**
 * The 새 리스트 추가 sheet. Stacked over the picker rather than replacing it, so
 * dismissing it returns the member to the selection they had already made.
 */
function CreateListSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (list: PlaceListSummaryDTO) => void;
}) {
  const [form, setForm] = useState<ListFormValue>(EMPTY_LIST_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Reset during render rather than in an effect: this is state derived from
  // the sheet's own open/closed transition, and lint's
  // `react-hooks/set-state-in-effect` forbids the effect form — which would
  // also paint the previous list's values for one frame.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setForm(EMPTY_LIST_FORM);
  }

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
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
        throw new Error(await errorMessage(res, "리스트를 만들지 못했습니다."));
      }
      const { seq } = (await res.json()) as { seq: number };
      onCreated({
        seq,
        name: form.name.trim(),
        color: form.color,
        description: form.description || null,
        visibility: form.visibility,
        isDefault: false,
        count: 0,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "리스트를 만들지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col gap-0 rounded-t-2xl p-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:top-[100dvh] data-[side=bottom]:bottom-auto data-[side=bottom]:-translate-y-full data-[side=bottom]:data-ending-style:translate-y-0 data-[side=bottom]:data-starting-style:translate-y-0 sm:rounded-2xl"
        showCloseButton={false}
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 border-b p-5">
          <SheetTitle className="text-lg">새 리스트 추가</SheetTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="닫기"
            className="shrink-0 rounded-full text-muted-foreground"
          >
            <X aria-hidden />
          </Button>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <ListFormFields value={form} onChange={setForm} />
        </div>

        <div className="border-t p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <Button
            type="button"
            onClick={submit}
            // The name is the only required field, matching the design's
            // disabled 완료 button. The server checks it too.
            disabled={
                submitting ||
                form.name.trim().length === 0 ||
                !isValidListLinkUrl(form.linkUrl)
              }
            className="h-13 w-full text-base"
          >
            {submitting ? "만드는 중…" : "완료"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
