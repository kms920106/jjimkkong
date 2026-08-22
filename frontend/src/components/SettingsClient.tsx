"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { SettingsHeader } from "@/components/SettingsHeader";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * Every row is this shape, whether it navigates or acts.
 *
 * Rendering both through one component is what keeps the list uniform: the
 * label sits at the same x, the chevron at the same right edge, and the height
 * is identical whether the row is an <a> or a <button>. Styling them separately
 * is how a list like this drifts a pixel at a time.
 */
const ROW =
  "flex w-full items-center justify-between bg-background px-4 pr-5 py-5 text-left transition hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-background";
const ROW_LABEL = "text-sm text-foreground";
// Exact arbitrary values, not a scale class — the source PNG only reads as
// the design's slim chevron at its native 6.5:11.5 ratio.
const ROW_CHEVRON = "h-[11.5px] w-[6.5px] shrink-0";

function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <ChevronIcon direction="right" className={ROW_CHEVRON} />
    </Link>
  );
}

function ActionRow({
  label,
  onClick,
  disabled,
}: {
  label: string;
  /** Omitted by the disabled placeholder rows, which have nothing to do. */
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <ChevronIcon direction="right" className={ROW_CHEVRON} />
    </button>
  );
}

/**
 * A group of rows: white rows, hairlines between them, and the page's grey
 * showing through as a band above and below.
 *
 * The gap between groups is the separator — there are no group headings. That
 * is the whole grammar of this screen, and it is why 지도 선택 does not live
 * here: a radio block is not a row, and one non-row in a list like this reads
 * as a mistake. It stays in `AppDrawer` where it started.
 */
function RowGroup({
  children,
  noTopBorder,
}: {
  children: React.ReactNode;
  /** The first group sits flush under SettingsHeader's own border-b — without
   * this its border-t would sit right against that line and the two hairlines
   * would read as one heavy line instead of a header and a separator. */
  noTopBorder?: boolean;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border/60 border-b border-border/60",
        !noTopBorder && "border-t",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The settings page: a flat list of rows, grouped by grey bands.
 *
 * A page rather than the panel it used to be inside AppDrawer. Every row here
 * either leaves for another screen or ends the session, and a panel that has to
 * survive those navigations only to be dismissed on arrival is doing a page's
 * job. The drawer keeps what it is good at — the profile header, the two
 * destinations, and the map picker, which is the one setting that changes what
 * is rendered directly behind it.
 *
 * Public like the rest of `(app)`: signed out the legal rows still work and the
 * account rows are disabled. `DELETE /api/account` and the password route are
 * the actual gates.
 */
export default function SettingsClient({
  signedIn,
  hasPassword,
  savedCount,
}: {
  signedIn: boolean;
  /** Only picks the row's wording; both cases go to the same page. */
  hasPassword: boolean;
  savedCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  // Separate from `error`, which renders in the list — a failed withdrawal has
  // to appear in the dialog the user is looking at.
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  async function signOut() {
    setError(null);
    // Revokes the session row as well as the cookie, so the token is dead even
    // if a copy of it was captured.
    const res = await fetch("/api/auth/logout", { method: "POST" }).catch(
      () => null,
    );
    // Navigating regardless would be worse than not navigating: home renders
    // from the session that is still alive, so the user would see their own
    // pins and read that as "signed out but the map is broken" rather than as
    // "still signed in". The old drawer did exactly that.
    if (!res?.ok) {
      setError("로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    // Home, not a login page — there is no longer one. refresh() rebuilds the
    // tree without the session, which is what empties the map of pins.
    router.push("/");
    router.refresh();
  }

  async function withdraw() {
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      // No body: the dialog itself is the confirmation, so there is nothing to
      // send. Content-Type is still set — it is what forces a CORS preflight on
      // a cross-origin attempt, which requireSameOrigin() then rejects outright.
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string" ? body.error : "탈퇴하지 못했습니다.",
        );
      }
      setWithdrawOpen(false);
      // `withdrawing` deliberately stays set: the push unmounts this component,
      // and clearing it first would re-enable 탈퇴하기 while the navigation is
      // still in flight — a second click would then DELETE an account that is
      // already gone and surface the 401 as a failure to the user.
      router.push("/");
      router.refresh();
    } catch (cause) {
      setWithdrawError(
        cause instanceof Error ? cause.message : "탈퇴하지 못했습니다.",
      );
      setWithdrawing(false);
    }
  }

  return (
    // The grey is the page, not a container: rows run edge to edge and the gaps
    // between groups let it through. `min-h-screen` so the band below the last
    // group reaches the bottom on a short list instead of stopping mid-screen.
    <div className="min-h-screen bg-neutral-50">
      <SettingsHeader href="/" ariaLabel="지도로 돌아가기" title="설정" />

      {!signedIn && (
        <Alert className="rounded-none border-x-0">
          <AlertDescription>
            로그인한 뒤에 계정 설정을 변경할 수 있습니다.
          </AlertDescription>
        </Alert>
      )}

      {/* The gap IS the separator, so it has to read as a band rather than as a
          hairline — thin gaps look like an accidental double border. No top
          padding: the first group sits flush under SettingsHeader's border-b,
          which is why that group passes noTopBorder. */}
      <nav className="flex flex-col gap-2.5">
        <RowGroup noTopBorder>
          {signedIn ? (
            <LinkRow
              href="/settings/password"
              label={hasPassword ? "비밀번호 변경" : "비밀번호 설정"}
            />
          ) : (
            // Rendered disabled rather than hidden so the list does not change
            // shape on sign-in, and so the row still says what is here.
            <ActionRow label="비밀번호 변경" disabled />
          )}
        </RowGroup>

        {/* Always present, signed in or not — 개인정보처리방침 is a disclosure
            the law requires to be kept continuously public, not shown once at
            sign-up. */}
        <RowGroup>
          <LinkRow href="/terms" label="이용약관" />
          <LinkRow href="/privacy" label="개인정보처리방침" />
        </RowGroup>

        <RowGroup>
          {/* Both plain, including 회원탈퇴. Colouring one row red would break
              the only rule this list has — every row looks the same — and the
              warning it would carry is already the whole content of the
              confirmation dialog, which is where it can actually be read. */}
          <ActionRow
            label="로그아웃"
            onClick={() => void signOut()}
            disabled={!signedIn}
          />
          <ActionRow
            label="회원탈퇴"
            disabled={!signedIn}
            onClick={() => {
              // Reset here, not on close: reopening after a failed attempt
              // should start clean, and the dialog keeps no state of its own.
              setWithdrawError(null);
              setWithdrawOpen(true);
            }}
          />
        </RowGroup>
      </nav>

      {error && (
        <Alert variant="destructive" className="mt-2.5 rounded-none border-x-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <AlertDialog
        open={withdrawOpen}
        onOpenChange={(next) => {
          // Mid-delete: dismissing would leave the user on a page whose account
          // may already be gone, with no indication either way.
          if (!next && withdrawing) return;
          setWithdrawOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>회원탈퇴</AlertDialogTitle>
            <AlertDialogDescription>
              탈퇴하면 지금 바로 로그아웃되고, 저장한 링크 {savedCount}개를 다시
              볼 수 없습니다. 같은 계정으로 다시 로그인하더라도 새 계정으로
              시작하며 이전 링크는 복구되지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {withdrawError && (
            <Alert variant="destructive">
              <AlertDescription>{withdrawError}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={withdrawing}>취소</AlertDialogCancel>
            <AlertDialogAction
              // A plain Button, not a Base UI Close, so nothing dismisses the
              // dialog for us — withdraw() closes it, and only once the delete
              // actually succeeded. A Close here would tear the dialog down
              // mid-request and swallow the error message.
              onClick={() => void withdraw()}
              disabled={withdrawing}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {withdrawing ? "탈퇴 중…" : "탈퇴하기"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
