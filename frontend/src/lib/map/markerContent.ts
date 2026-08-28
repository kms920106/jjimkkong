import { categoryLeaf } from "@/lib/place-category";
import type { MapMarker } from "@/lib/map/types";

/**
 * The marker label, in the two shapes the three SDKs need.
 *
 * Built here rather than in each provider component so the pin looks identical
 * whichever map the user picked — the three SDKs disagree about how a custom
 * marker is supplied (Naver takes an HTML *string* as `icon.content`, Kakao a
 * string or element as `CustomOverlay.content`, Google a real DOM node as
 * `AdvancedMarkerElement.content`), and that is a difference in plumbing, not
 * in what a pin is.
 *
 * Styles live in `app/globals.css` as plain `.jk-marker*` classes. **Do not
 * switch them to Tailwind utilities.** React never renders this markup, so
 * Tailwind v4's scanner cannot see class names composed into these strings and
 * would drop them from the production build — while `next dev` still looked
 * correct, because its JIT picks the same utilities up from other files.
 */

/**
 * The label's nominal box in CSS px, declared to Naver's `HtmlIcon` as
 * `size`/`anchor`. Matches `.jk-marker__chip`'s `max-width` (7rem = 112px) plus
 * the stem.
 *
 * **These do not actually position the pin.** Measured in the browser: Naver
 * sizes the marker wrapper to the rendered content, not to the declared `size`,
 * and derives the anchor from that — chips from 44px to 112px wide all land
 * with their stem dead-centre on the coordinate (dx 0, dy ≤1px). So the values
 * are a declaration of intent that the SDK re-derives, and a mismatch with the
 * CSS does not offset anything. Kept in sync anyway because the SDK is free to
 * start honouring them, and kept here rather than inlined so the two providers
 * that need a size read the same number.
 */
export const MARKER_WIDTH = 112;
/** Chip (two lines) + stem. Anchored at the bottom so the stem meets the place. */
export const MARKER_HEIGHT = 52;

/**
 * The stacking order for one pin.
 *
 * Every marker used to share a single z-index, and that made overlapping chips
 * unreachable rather than merely untidy: with the order a tie, it fell to DOM
 * order, so the same chip won every time and the pin underneath could not be
 * tapped at all (measured at overview zoom: 4 of 15 pins). A label is far wider
 * than the dot it replaced, so overlap is normal, not an edge case.
 *
 * Ordering by latitude is what map apps do — the souther pin reads as nearer
 * the viewer, so it draws in front. It also gives every pin a *distinct* value,
 * which is the part that matters: the one on top is then predictable from
 * position rather than from array order, and panning does not reshuffle it.
 *
 * Seoul spans roughly 37.4–37.7°N; the whole country fits 33–39. Scaling by
 * 1000 keeps a metre of latitude distinguishable while staying far inside the
 * integer range the SDKs accept.
 */
export function markerZIndex(lat: number, selected: boolean): number {
  // Selected pins go above every unselected one, whatever their latitude:
  // the chip the sheet is describing must not be hidden behind a neighbour.
  if (selected) return MARKER_Z_SELECTED;
  return Math.round((90 - lat) * 1000);
}

/**
 * Above every latitude-derived value (max ≈ (90 − 33) × 1000 = 57,000), so the
 * selection always wins.
 */
export const MARKER_Z_SELECTED = 1_000_000;

/**
 * `name` and `category` come from Naver's local search — external text, placed
 * into an HTML string. Escaped rather than trusted: a place name carrying `<`
 * would otherwise be parsed as markup by the two providers that take a string.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function classNames(selected: boolean): string {
  return selected ? "jk-marker jk-marker--selected" : "jk-marker";
}

/** The label as an HTML string — Naver's `icon.content` and Kakao's `content`. */
export function markerHtml(marker: MapMarker, selected: boolean): string {
  const leaf = categoryLeaf(marker.category);
  // Omitted entirely when there is no category, so the chip is one line rather
  // than a line plus an empty gap.
  const category = leaf
    ? `<span class="jk-marker__category">${escapeHtml(leaf)}</span>`
    : "";
  return (
    `<div class="${classNames(selected)}">` +
    `<div class="jk-marker__chip">` +
    `<span class="jk-marker__name">${escapeHtml(marker.name)}</span>` +
    category +
    `</div>` +
    `<div class="jk-marker__stem"></div>` +
    `</div>`
  );
}

/**
 * The same label as a detached DOM node, for Google's `AdvancedMarkerElement`,
 * which takes an element and not a string.
 *
 * Assembled with `textContent` rather than `innerHTML` — the escaping above
 * exists because a string has to be parsed as markup, and here there is no
 * reason to reintroduce that step.
 */
export function markerElement(
  marker: MapMarker,
  selected: boolean,
): HTMLElement {
  const root = document.createElement("div");
  root.className = classNames(selected);

  const chip = document.createElement("div");
  chip.className = "jk-marker__chip";

  const name = document.createElement("span");
  name.className = "jk-marker__name";
  name.textContent = marker.name;
  chip.appendChild(name);

  const leaf = categoryLeaf(marker.category);
  if (leaf) {
    const category = document.createElement("span");
    category.className = "jk-marker__category";
    category.textContent = leaf;
    chip.appendChild(category);
  }

  const stem = document.createElement("div");
  stem.className = "jk-marker__stem";

  root.appendChild(chip);
  root.appendChild(stem);
  return root;
}
