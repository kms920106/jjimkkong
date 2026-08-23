import type { Platform } from "@/lib/types";

/**
 * What a saved link is called in the UI, keyed by the platform it came from.
 *
 * A Record rather than a lookup over the filter array /links used to keep this
 * in: the filter row is a list of *tabs*, which is a view concern, and the
 * detail page needs the same names without inheriting "전체". Typing it as
 * Record<Platform, string> also makes the compiler demand an entry when a new
 * platform is added to the enum — an array find would just return undefined
 * and fall through to the generic label.
 */
const LABELS: Record<Platform, string> = {
  INSTAGRAM: "인스타그램",
  YOUTUBE: "유튜브",
  NAVER: "네이버맵",
  KAKAO: "카카오맵",
  OTHER: "기타",
};

export function platformLabel(platform: Platform): string {
  return LABELS[platform] ?? "원본 링크";
}
