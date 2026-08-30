"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Globe, Link2, Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsHeader } from "@/components/SettingsHeader";
import {
  EMPTY_LIST_FORM,
  isValidListLinkUrl,
  ListFormFields,
  type ListFormValue,
} from "@/components/list/ListFormFields";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { errorMessage } from "@/lib/api-client";
import { useBackLink } from "@/lib/use-back-link";
import { ListVisibility } from "@/generated/prisma/enums";
import type { PlaceListSummaryDTO } from "@/lib/types";

/**
 * The icon and label for a list's visibility, shown on its row.
 *
 * The private case says "비공개" in words while the two shared cases show only
 * an icon, matching the design — and matching what the member needs to scan
 * for. A private list is the default and the safe state; the ones worth
 * spotting at a glance are the ones that left.
 */
function VisibilityMark({ visibility }: { visibility: ListVisibility }) {
  if (visibility === ListVisibility.PRIVATE) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Lock aria-hidden className="size-3" />
        비공개
      </span>
    );
  }
  const Icon = visibility === ListVisibility.PUBLIC ? Globe : Link2;
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <Icon aria-hidden className="size-3" />
      {visibility === ListVisibility.PUBLIC ? "전체 공개" : "일부 공개"}
    </span>
  );
}

/**
 * The member's saved lists — the design's 저장 tab.
 *
 * Public like every other page here: signed out it renders the empty state and
 * offers a login rather than redirecting. The 새 리스트 만들기 button is the
 * only control that needs an account, and the API is the gate as always.
 */
export default function ListsClient({
  initialLists,
  signedIn,
}: {
  initialLists: PlaceListSummaryDTO[];
  signedIn: boolean;
}) {
  const router = useRouter();
  const { onBackClick } = useBackLink();
  const [lists, setLists] = useState(initialLists);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ListFormValue>(EMPTY_LIST_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function create() {
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
      setLists((current) => [
        ...current,
        {
          seq,
          name: form.name.trim(),
          color: form.color,
          description: form.description || null,
          visibility: form.visibility,
          isDefault: false,
          count: 0,
        },
      ]);
      setCreating(false);
      setForm(EMPTY_LIST_FORM);
      // The optimistic row above is what the member sees immediately; this
      // reconciles the ordering the server actually applied (default pinned,
      // then newest first) without them waiting on it.
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "리스트를 만들지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <SettingsHeader
        href="/"
        ariaLabel="지도로 돌아가기"
        title="저장"
        onBackClick={onBackClick}
      />

      {lists.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted-foreground">
          {signedIn
            ? "아직 저장한 장소가 없어요. 지도에서 장소를 눌러 별을 눌러 보세요."
            : "로그인하면 장소를 리스트로 모을 수 있어요."}
        </p>
      ) : (
        <ul className="px-4">
          {lists.map((list) => (
            <li key={list.seq}>
              <Link
                href={`/lists/${list.seq}`}
                className="flex items-center gap-3 border-b py-4"
              >
                <span
                  aria-hidden
                  className="size-11 shrink-0 rounded-full"
                  style={{ backgroundColor: list.color }}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{list.name}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground tabular-nums">
                      {list.count}개
                    </span>
                    <span aria-hidden className="text-muted-foreground">
                      |
                    </span>
                    <VisibilityMark visibility={list.visibility} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {signedIn && (
        <div className="px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <Button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto flex h-13 rounded-full px-6 text-base"
          >
            <Plus aria-hidden />새 리스트 만들기
          </Button>
        </div>
      )}

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent
          side="bottom"
          className="mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col gap-0 rounded-t-2xl p-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:top-[100dvh] data-[side=bottom]:bottom-auto data-[side=bottom]:-translate-y-full data-[side=bottom]:data-ending-style:translate-y-0 data-[side=bottom]:data-starting-style:translate-y-0 sm:rounded-2xl"
        >
          <SheetHeader className="border-b p-5">
            <SheetTitle className="text-lg">새 리스트 추가</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <ListFormFields value={form} onChange={setForm} />
          </div>
          <div className="border-t p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <Button
              type="button"
              onClick={create}
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
    </div>
  );
}
