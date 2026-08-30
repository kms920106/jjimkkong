/**
 * The seven swatches a list can be coloured with.
 *
 * An allowlist rather than free-form hex, and that is a security property, not
 * a style one: the value is rendered into an inline `background-color`, and an
 * unchecked string there is an injection into a style attribute. Validating
 * against this list at the route boundary is what makes the render site safe to
 * keep simple.
 *
 * Stored as the hex itself rather than an enum name, so a repaint is a change
 * here plus a one-line data fix rather than a migration — see the `color`
 * column's note in schema.prisma. The trade is that changing a hex orphans the
 * old value on existing rows; `isListColor()` therefore only gates *writes*, and
 * the render path accepts whatever the row holds.
 */
export const LIST_COLORS = [
  "#F85E6B",
  "#FA8231",
  "#FBC531",
  "#8BC34A",
  "#22C7CE",
  "#E0409B",
  "#FA9E9E",
] as const;

export type ListColor = (typeof LIST_COLORS)[number];

/** The swatch a list gets when the caller names none — the design's first. */
export const DEFAULT_LIST_COLOR: ListColor = LIST_COLORS[0];

/**
 * Whether `value` is one of the seven. Used at the write boundary only; reads
 * must not filter on it, or a row written under an older palette would render
 * with no colour at all.
 */
export function isListColor(value: string): value is ListColor {
  return (LIST_COLORS as readonly string[]).includes(value);
}
