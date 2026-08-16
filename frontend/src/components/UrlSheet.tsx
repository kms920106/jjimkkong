"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Whether the clipboard API exists cannot change while the sheet is open. */
function subscribeToNothing(): () => void {
  return () => {};
}

type Props = {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (url: string) => void;
};

/**
 * Mounted only while open, so mounting is the "sheet opened" event — the
 * initial clipboard read happens here rather than in an effect watching a
 * prop.
 */
export default function UrlSheet({ busy, error, onClose, onSubmit }: Props) {
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

  /**
   * Focus only. There used to be a silent clipboard.readText() here to
   * pre-fill the field, but on iOS Safari that call is not silent: it raises
   * the system "Paste" confirmation *on top of* the sheet, so the user saw a
   * bare Paste button instead of the dialog they asked for. The explicit
   * 붙여넣기 button and the input's onPaste handler cover the same shortcut
   * without hijacking the open.
   */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    // dvh rather than inset-0: iOS shrinks the visual viewport when the
    // keyboard opens but leaves the layout viewport (and so inset-0) at full
    // height, which pushed the sheet's lower half off screen.
    <div className="fixed inset-x-0 top-0 z-50 flex h-dvh items-end justify-center sm:items-center">
      <div
        aria-hidden
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="링크 추가"
        // pb picks up the home-indicator inset so the button is never under
        // it; max-h + overflow keep the sheet scrollable instead of clipped
        // when the keyboard leaves very little room.
        className="relative max-h-dvh w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:pb-5 dark:bg-neutral-950"
      >
        <div className="flex items-center justify-between pb-4">
          <h2 className="text-base font-semibold">링크 추가</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="닫기"
            className="rounded-full p-1.5 text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-900"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

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
            <input
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
              className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
            {/* Hidden where navigator.clipboard does not exist, since there
                the button could only ever do nothing. */}
            {canReadClipboard && (
              <button
                type="button"
                onClick={pasteFromClipboard}
                disabled={pasting || busy}
                className="shrink-0 rounded-xl border border-neutral-300 px-3.5 py-3 text-sm font-medium whitespace-nowrap transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                붙여넣기
              </button>
            )}
          </div>
          {!canReadClipboard && url === "" && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              입력창을 길게 눌러 &lsquo;붙여넣기&rsquo;를 선택하세요.
            </p>
          )}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="w-full rounded-xl bg-neutral-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {busy ? "읽는 중…" : "저장"}
          </button>
        </form>
      </div>
    </div>
  );
}
