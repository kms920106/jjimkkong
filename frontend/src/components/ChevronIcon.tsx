import Image from "next/image";

/**
 * Design-provided PNGs, not a drawn shape: the two call sites (header back
 * button at 9x15.5, row chevron at 6.5x11.5) use different source assets
 * because they are different glyphs at different native aspect ratios, not
 * one icon scaled two ways. `width`/`height` here are each asset's intrinsic
 * pixel size, required by next/image for layout reservation; the rendered
 * box size is set by the caller's `className` instead — see the exact-px
 * comments at each call site.
 */
const SOURCES = {
  left: { src: "/icons/chevron-back.png", width: 27, height: 47 },
  right: { src: "/icons/chevron-forward.png", width: 20, height: 35 },
} as const;

export function ChevronIcon({
  direction,
  className,
}: {
  direction: "left" | "right";
  className?: string;
}) {
  const { src, width, height } = SOURCES[direction];
  return (
    <Image src={src} width={width} height={height} alt="" className={className} />
  );
}
