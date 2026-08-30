"use client";

import { Globe, Link2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { LIST_COLORS } from "@/lib/place-list/palette";
import { ListVisibility } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * The three visibility options, with the wording the picker shows.
 *
 * `LINK` and `PUBLIC` both serve the page to anyone holding the URL — the only
 * difference is whether the list is also enumerated on the owner's public
 * index. The copy has to say that, because "일부 공개" otherwise reads as an
 * access restriction it is not: a link-shared list is public to whoever has the
 * link, it is merely unlisted.
 */
const VISIBILITY_OPTIONS = [
  {
    value: ListVisibility.PRIVATE,
    icon: Lock,
    label: "비공개",
    description: "나만 볼 수 있으며, 다른 사람과 공유할 수 없습니다.",
  },
  {
    value: ListVisibility.LINK,
    icon: Link2,
    label: "일부 공개",
    description: "URL로 공유하고 링크가 있는 모든 사용자가 볼 수 있습니다.",
  },
  {
    value: ListVisibility.PUBLIC,
    icon: Globe,
    label: "전체 공개",
    description: "URL로 공유하고 내 공개 리스트 목록에 노출됩니다.",
  },
] as const;

export type ListFormValue = {
  name: string;
  color: string;
  description: string;
  linkUrl: string;
  visibility: ListVisibility;
};

export const EMPTY_LIST_FORM: ListFormValue = {
  name: "",
  color: LIST_COLORS[0],
  description: "",
  linkUrl: "",
  visibility: ListVisibility.PRIVATE,
};

/**
 * Whether `linkUrl` would survive the route's schema — empty, or an absolute
 * http(s) URL.
 *
 * The `type="url"` attribute on the input does *not* cover this: native
 * constraint validation only fires on `<form>` submission, and all three sheets
 * submit from a button's onClick, so an arbitrary string reaches the server
 * untouched. It came back as the schema's generic "요청 형식이 올바르지
 * 않습니다." toast, which names neither the field nor the rule — the user is
 * told the request was malformed while looking at four filled-in inputs.
 *
 * Mirrors the route's check rather than replacing it: the server still refuses
 * `javascript:`, which is the reason the restriction exists at all.
 */
export function isValidListLinkUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  try {
    return /^https?:$/i.test(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/**
 * The name/colour/visibility/description fields, shared by the create sheet and
 * the edit sheet.
 *
 * Shared rather than duplicated because the two must agree on the *limits* —
 * the 20- and 30-character counters are rendered here and enforced again by the
 * same numbers in the route's Zod schema. Two copies of a form drift on exactly
 * that kind of detail, and the visible counter disagreeing with the server is
 * how a user gets a rejection they were told would not happen.
 *
 * `lockName` and `lockVisibility` are for the implicit "내 장소": it must keep a
 * recognisable name and stay private (the server refuses both edits, and so
 * does a database CHECK). Disabling the inputs is the affordance for a rule
 * enforced elsewhere, never the enforcement.
 */
export function ListFormFields({
  value,
  onChange,
  lockName = false,
  lockVisibility = false,
}: {
  value: ListFormValue;
  onChange: (next: ListFormValue) => void;
  lockName?: boolean;
  lockVisibility?: boolean;
}) {
  const set = <K extends keyof ListFormValue>(
    key: K,
    next: ListFormValue[K],
  ) => onChange({ ...value, [key]: next });

  const linkUrlValid = isValidListLinkUrl(value.linkUrl);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Input
            value={value.name}
            onChange={(event) => set("name", event.target.value)}
            // Matches the Zod limit on the route. The browser stops the typing
            // and the server still checks, which is the usual pairing: the
            // attribute is the affordance, the schema is the rule.
            maxLength={20}
            disabled={lockName}
            placeholder="새 리스트 명을 입력해주세요."
            aria-label="리스트 이름"
            className="h-14 bg-muted pr-16 text-base"
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground tabular-nums">
            {value.name.length}/20
          </span>
        </div>
        {lockName && (
          <p className="text-xs text-muted-foreground">
            기본 리스트의 이름은 바꿀 수 없어요.
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-semibold">색상선택</legend>
        {/* Radios rather than buttons: this is a single choice out of a fixed
            set, so arrow-key navigation and the announced group name come for
            free. `sr-only` keeps the native input focusable — hiding it with
            `display:none` would take it out of the tab order entirely. */}
        <div className="flex flex-wrap gap-3">
          {LIST_COLORS.map((color) => (
            <label
              key={color}
              className="relative cursor-pointer rounded-full focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-ring"
            >
              <input
                type="radio"
                name="list-color"
                value={color}
                checked={value.color === color}
                onChange={() => set("color", color)}
                className="sr-only"
              />
              <span className="sr-only">색상 {color}</span>
              <span
                aria-hidden
                className={cn(
                  "block size-11 rounded-full ring-offset-2 ring-offset-background transition",
                  value.color === color && "ring-2 ring-primary",
                )}
                // The one inline style in this component, and the reason
                // `color` is validated against an allowlist at the write
                // boundary rather than by a hex pattern — see palette.ts.
                style={{ backgroundColor: color }}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">공개 범위</legend>
        <RadioGroup
          value={value.visibility}
          onValueChange={(next) =>
            set("visibility", next as ListVisibility)
          }
          disabled={lockVisibility}
          className="flex flex-col gap-2"
        >
          {VISIBILITY_OPTIONS.map((option) => (
            <Label
              key={option.value}
              className={cn(
                "flex items-start gap-3 rounded-xl border border-border p-4 transition",
                value.visibility === option.value && "border-primary",
                lockVisibility && "opacity-50",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-1.5 font-medium">
                  <option.icon aria-hidden className="size-4" />
                  {option.label}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {option.description}
                </span>
              </div>
              <RadioGroupItem value={option.value} className="mt-1 shrink-0" />
            </Label>
          ))}
        </RadioGroup>
        {lockVisibility && (
          <p className="mt-2 text-xs text-muted-foreground">
            기본 리스트는 공개할 수 없어요.
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          상세 설명 <span className="font-normal text-muted-foreground">선택</span>
        </h3>
        <div className="relative">
          <Input
            value={value.description}
            onChange={(event) => set("description", event.target.value)}
            maxLength={30}
            placeholder="메모를 남겨주세요."
            aria-label="상세 설명"
            className="h-14 bg-muted pr-16 text-base"
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground tabular-nums">
            {value.description.length}/30
          </span>
        </div>
        <Input
          value={value.linkUrl}
          onChange={(event) => set("linkUrl", event.target.value)}
          // `type="url"` rather than text: it brings the right mobile keyboard.
          // It does *not* validate anything here — native constraint validation
          // only runs on form submission and these sheets submit from a button,
          // which is why `isValidListLinkUrl` exists. The real restriction —
          // http(s) only, so a `javascript:` URL cannot ride a shared list into
          // a viewer's browser — is enforced by the route's schema.
          type="url"
          inputMode="url"
          placeholder="관련 URL을 추가해주세요."
          aria-label="관련 URL"
          aria-invalid={!linkUrlValid}
          aria-describedby={linkUrlValid ? undefined : "list-link-url-error"}
          className="h-14 bg-muted text-base"
        />
        {!linkUrlValid && (
          <p id="list-link-url-error" className="text-xs text-destructive">
            http:// 또는 https://로 시작하는 주소를 입력해 주세요.
          </p>
        )}
      </div>
    </div>
  );
}
