"use client";

import { XIcon } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import IngestProgressBar from "@/components/IngestProgressBar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** Whether the clipboard API exists cannot change while the sheet is open. */
function subscribeToNothing(): () => void {
  return () => {};
}

type Props = {
  busy: boolean;
  /**
   * What to show on the button while busy. Passed in rather than derived here
   * because the stage it names arrives from the ingest stream, which the
   * parent reads — this component only renders it.
   */
  busyLabel: string;
  /**
   * 0–100 for the bar across the top, or null when nothing is in flight.
   * Computed by the parent for the same reason `busyLabel` is: the stages it
   * is derived from arrive on the ingest stream, which only the parent reads.
   */
  progress: number | null;
  onClose: () => void;
  onSubmit: (url: string) => void;
};

/** Mounted only while open, so mounting is the "sheet opened" event. */
export default function UrlSheet({
  busy,
  busyLabel,
  progress,
  onClose,
  onSubmit,
}: Props) {
  const [url, setUrl] = useState("");
  const [pasting, setPasting] = useState(false);
  // navigator.clipboard only exists in a secure context. Over plain HTTP —
  // which is how the app is reached by IP during phone testing — it is
  // undefined, so the paste button cannot work and would be a dead control.
  // Read through useSyncExternalStore so the server render sees `false` and
  // the client corrects it without a hydration mismatch.
  const canReadClipboard = useSyncExternalStore(
    subscribeToNothing,
    () => typeof navigator.clipboard?.readText === "function",
    () => false,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  /** Runs inside the button's own gesture, which is what iOS requires. */
  async function pasteFromClipboard() {
    setPasting(true);
    try {
      const text = await navigator.clipboard.readText();
      // Unlike the silent read this is an explicit request, so whatever is on
      // the clipboard goes in — the server rejects a bad link with a message,
      // and refusing to paste here would look broken.
      setUrl(text.trim());
      inputRef.current?.focus();
    } catch {
      // iOS shows its own "Paste" confirmation and rejects if the user
      // declines. The keyboard is still there, so there is nothing to report.
    } finally {
      setPasting(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        // dvh rather than inset-0: iOS shrinks the visual viewport when the
        // keyboard opens but leaves the layout viewport (and so inset-0) at
        // full height, which pushed the sheet's lower half off screen. The
        // sheet is anchored to the bottom of the *dynamic* viewport with
        // top + translate rather than the primitive's bottom-0, and max-h +
        // overflow keep it scrollable instead of clipped when the keyboard
        // leaves very little room. pb picks up the home-indicator inset so
        // the button is never under it.
        //
        // On sm+ the bottom sheet becomes a centered dialog, which the
        // generated data-[side=bottom] rules do not express on their own.
        // The overrides carry the same data-[side=bottom] prefix so
        // tailwind-merge replaces the generated rules instead of stacking
        // with them.
        // The generated enter/exit rules translate on the Y axis too, under a
        // longer variant prefix that tailwind-merge treats as its own group —
        // so they survive alongside the anchor translate above and fight it
        // mid-transition. Cancelling them leaves opacity, which the base class
        // already animates, to carry the transition on its own.
        className="mx-auto max-h-dvh w-full max-w-lg gap-0 overflow-y-auto rounded-t-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] data-[side=bottom]:inset-x-0 data-[side=bottom]:top-[100dvh] data-[side=bottom]:bottom-auto data-[side=bottom]:-translate-y-full data-[side=bottom]:data-ending-style:-translate-y-full data-[side=bottom]:data-starting-style:-translate-y-full sm:rounded-2xl sm:border sm:pb-5 sm:data-[side=bottom]:top-1/2 sm:data-[side=bottom]:-translate-y-1/2 sm:data-[side=bottom]:data-ending-style:-translate-y-1/2 sm:data-[side=bottom]:data-starting-style:-translate-y-1/2"
        // Base UI focuses the first tabbable element by default, and on touch
        // it focuses the popup instead to keep the keyboard down. The URL
        // field is the whole point of the sheet, so it is named explicitly.
        //
        // Focus only. There used to be a silent clipboard.readText() here to
        // pre-fill the field, but on iOS Safari that call is not silent: it
        // raises the system "Paste" confirmation *on top of* the sheet, so the
        // user saw a bare Paste button instead of the dialog they asked for.
        // The explicit 붙여넣기 button and the input's onPaste handler cover
        // the same shortcut without hijacking the open.
        initialFocus={inputRef}
        showCloseButton={false}
      >
        {/* Pulled out to the sheet's own edges with negative margins: the
            content sits inside p-5, but a progress bar reads as part of the
            surface's frame rather than of its contents, and an inset one
            looks like a stray divider. Corners match the sheet's own lip —
            the sheet clips vertical overflow but not horizontal, so a square
            edge here would poke past the rounding rather than be trimmed. */}
        <IngestProgressBar
          value={progress}
          className="-mx-5 -mt-5 mb-4 rounded-t-2xl"
        />

        {/* The built-in close button is suppressed above in favour of this
            one, which takes `disabled={busy}` — the built-in has no way to
            refuse a close while the ingest request is still in flight. */}
        <SheetHeader className="flex-row items-center justify-between p-0 pb-4">
          <SheetTitle>링크 추가</SheetTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            disabled={busy}
            aria-label="닫기"
            className="rounded-full text-muted-foreground"
          >
            <XIcon />
          </Button>
        </SheetHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = url.trim();
            if (!trimmed || busy) return;
            onSubmit(trimmed);
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              // The native paste carries the text with it, so this is the one
              // route that needs neither a secure context nor a permission —
              // it is what actually works on an iPhone reached over HTTP.
              onPaste={(event) => {
                const text = event.clipboardData.getData("text");
                if (!text) return;
                event.preventDefault();
                setUrl(text.trim());
              }}
              placeholder="인스타그램 · 유튜브 · 지도 링크"
              className="h-auto min-w-0 flex-1 rounded-xl px-4 py-3"
            />
            {/* Hidden where navigator.clipboard does not exist, since there
                the button could only ever do nothing. */}
            {canReadClipboard && (
              <Button
                type="button"
                variant="outline"
                onClick={pasteFromClipboard}
                disabled={pasting || busy}
                className="h-auto shrink-0 rounded-xl px-3.5 py-3"
              >
                붙여넣기
              </Button>
            )}
          </div>
          {!canReadClipboard && url === "" && (
            <p className="text-xs text-muted-foreground">
              입력창을 길게 눌러 &lsquo;붙여넣기&rsquo;를 선택하세요.
            </p>
          )}
          <Button
            type="submit"
            disabled={busy || !url.trim()}
            className="h-auto w-full rounded-xl px-5 py-3"
          >
            {busy ? busyLabel : "저장"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
