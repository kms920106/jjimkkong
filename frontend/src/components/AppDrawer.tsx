"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Pencil, Settings } from "lucide-react";
import { displayName, type MapProvider, type ProfileDTO } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const PROVIDERS: Array<{ value: MapProvider; label: string }> = [
  { value: "NAVER", label: "네이버맵" },
  { value: "KAKAO", label: "카카오맵" },
  { value: "GOOGLE", label: "구글맵" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  profile: ProfileDTO;
};

/**
 * The left menu: who you are, where you can go, and which map you see.
 *
 * It used to hold the rest of the settings too — an inline password flow, legal
 * links, sign-out and withdrawal. Those moved to `/settings`, because each one
 * either leaves for another screen or ends the session, and a panel that has to
 * survive those navigations only to be dismissed on arrival is doing a page's
 * job.
 *
 * The map picker stayed. It is the one setting whose effect is *the thing
 * directly behind this drawer* — choosing 카카오맵 swaps the map the user is
 * looking at, and they see it happen as the drawer closes. Moving it into the
 * settings list would put a full navigation between the choice and its only
 * feedback, and a radio block is not a row in a list built entirely of rows.
 */
export default function AppDrawer({
  open,
  onClose,
  profile,
}: Props) {
  const router = useRouter();
  // The provider this panel has chosen, held until the prop agrees with it.
  //
  // It is not merely "the value of an in-flight save": clearing it when the
  // request settles is what made the radio flicker. `router.refresh()` is not
  // awaitable — it schedules an RSC refetch and returns — so at the moment the
  // PATCH resolves, `profile.mapProvider` is still the *old* value. Dropping
  // the local copy there hands the radio back to that stale prop, so it
  // snapped to the previous provider and only returned once the refetch
  // landed: a measured ~340ms of showing the wrong answer locally, and longer
  // on a slow round trip.
  //
  // So the local value outlives the request and is released by the prop
  // catching up (see the render-time reconciliation below) rather than by the
  // fetch finishing. A failure releases it immediately instead, since a value
  // the server rejected is not an answer worth keeping.
  const [chosenProvider, setChosenProvider] = useState<MapProvider | null>(
    null,
  );
  const [lastSavedProvider, setLastSavedProvider] = useState(
    profile.mapProvider,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adjusting state during render, React's documented pattern for state
  // derived from props, and the same one `IngestProgressBar` uses to latch its
  // width. An effect would be wrong twice over: this synchronises no external
  // system, and it would paint the superseded provider for a frame before
  // correcting it — which is the very flicker being removed. Lint's
  // `react-hooks/set-state-in-effect` rejects that shape anyway.
  if (profile.mapProvider !== lastSavedProvider) {
    setLastSavedProvider(profile.mapProvider);
    // The refetch has landed. The prop is authoritative again, so the local
    // copy is redundant — whether or not it matches, since a change made in
    // another tab should win here rather than be overridden by a stale choice.
    setChosenProvider(null);
  }

  const provider = chosenProvider ?? profile.mapProvider;

  async function selectProvider(next: MapProvider) {
    if (next === provider || saving) return;
    setChosenProvider(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapProvider: next }),
      });
      if (!res.ok) throw new Error("설정을 저장하지 못했습니다.");
      // Not awaited because it cannot be. `chosenProvider` covers the gap
      // until the refreshed prop arrives and the reconciliation above drops it.
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "설정을 저장하지 못했습니다.",
      );
      // Snap back: nothing was saved, so the prop is still the truth.
      setChosenProvider(null);
    } finally {
      setSaving(false);
    }
  }

  const name = displayName({ nickname: profile.nickname, email: profile.email });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="left" className="w-[85%] max-w-sm gap-0 sm:max-w-sm">
        <SheetTitle className="sr-only">메뉴</SheetTitle>

        {/* Sits left of SheetContent's own close button (top-3 right-3) so the
            two form one row instead of overlapping. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-12"
          nativeButton={false}
          render={<Link href="/settings" onClick={onClose} />}
        >
          <Settings className="h-4 w-4" />
          <span className="sr-only">설정</span>
        </Button>

        {/* Clears SheetContent's own close button, which sits at top-3 and is
            7 units tall — the name row would otherwise run under it. */}
        <div className="flex items-center gap-3 px-5 pt-12 pb-6">
          <Avatar className="h-12 w-12">
            {profile.imageUrl && <AvatarImage src={profile.imageUrl} alt="" />}
            <AvatarFallback className="text-lg font-semibold">
              {name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            {/* The pencil leaves the drawer instead of unfolding a field in it.
                Editing now covers a picture as well as text, and the picture
                step hands control to the OS file picker — a panel that may or
                may not still be mounted when the user comes back is worse than
                a page they navigate to and away from. */}
            <Link
              href="/profile"
              onClick={onClose}
              className="flex max-w-full items-center gap-1.5 text-left"
            >
              <span className="truncate text-base font-semibold">{name}</span>
              <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="sr-only">프로필 수정</span>
            </Link>
            {profile.statusMessage && (
              <p className="truncate text-xs text-muted-foreground">
                {profile.statusMessage}
              </p>
            )}
            {profile.email && (
              <p className="truncate text-xs text-muted-foreground">
                {profile.email}
              </p>
            )}
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-2 overflow-y-auto px-5 pb-6">
          <Link
            href="/links"
            onClick={onClose}
            className="flex items-center justify-between rounded-xl border border-border px-4 py-3.5 transition hover:bg-muted"
          >
            <span className="text-sm font-medium">링크</span>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <ChevronRight className="h-4 w-4" />
            </span>
          </Link>

          <h2 className="px-1 pt-5 pb-2 text-xs font-semibold text-muted-foreground">
            지도
          </h2>
          <RadioGroup
            value={provider}
            onValueChange={(next) => void selectProvider(next as MapProvider)}
            disabled={saving}
            className="gap-2"
          >
            {PROVIDERS.map((item) => (
              <Label
                key={item.value}
                className="cursor-pointer gap-3 rounded-xl border border-border px-4 py-3 transition hover:bg-muted"
              >
                <RadioGroupItem value={item.value} />
                <span className="text-sm font-medium">{item.label}</span>
              </Label>
            ))}
          </RadioGroup>

          {error && (
            <Alert variant="destructive" className="mt-1">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
