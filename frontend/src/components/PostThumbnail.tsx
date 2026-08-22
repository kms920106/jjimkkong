"use client";

import { useState, type ReactNode } from "react";

type Props = {
  src: string | null;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  /** Rendered instead of the image when `src` is null or the load fails. */
  fallback?: ReactNode;
};

/**
 * One post thumbnail, with a fallback for the ones that cannot load.
 *
 * An onError path is needed because some of this app's thumbnails are certain
 * to break. Instagram CDN URLs are signed and expire, and while the ingest
 * pipeline now copies those bytes to our own blob store, rows saved before that
 * — and rows where the backup failed — still hold the expiring URL and answer
 * `403 URL signature expired`. Without a handler the browser draws its default
 * broken-image icon, which reads as though the user saved a bad link.
 *
 * Not next/image, here or anywhere else that renders these: YouTube and map
 * thumbnails still come from platform CDNs, each needing its own remotePatterns
 * entry, and routing a 64px image through the optimizer buys nothing.
 *
 * The failure flag is component state and must reset when `src` changes, since
 * a re-save produces a new URL that deserves a fresh attempt. Callers get that
 * for free by mounting this with `key={src}` rather than this component running
 * a reset effect — cards are keyed by post id and keep their mount across a
 * refresh, which is exactly the situation where state goes stale unnoticed.
 */
export function PostThumbnail({
  src,
  alt,
  className,
  width,
  height,
  fallback = null,
}: Props) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <>{fallback}</>;

  return (
    // width/height reserve the box so rows do not reflow as images arrive,
    // lazy keeps offscreen rows off the critical path, and decoding=async
    // keeps a slow decode from blocking paint.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
