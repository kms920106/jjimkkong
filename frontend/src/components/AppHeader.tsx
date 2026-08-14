import Link from "next/link";

export default function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-base font-bold tracking-tight">
          찜꽁
        </Link>
        <Link
          href="/settings"
          className="text-sm text-neutral-500 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
        >
          설정
        </Link>
      </div>
    </header>
  );
}
