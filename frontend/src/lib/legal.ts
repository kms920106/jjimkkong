/**
 * Operator identity and the dates the two legal documents took effect.
 *
 * Shared rather than inlined per page because PIPA requires the privacy policy
 * to name a 개인정보 보호책임자 and the terms to name the operator, and the two
 * documents drifting apart is exactly the kind of inconsistency a regulator
 * reads as a defect. One edit here updates both.
 *
 * PLACEHOLDER VALUES — replace before launch. The privacy policy is a legally
 * required disclosure under 개인정보 보호법 제30조 and a wrong contact address
 * is worse than none.
 */
export const OPERATOR = {
  serviceName: "찜꽁",
  /** 상호. 사업자등록 전이면 운영자 개인 이름. */
  name: "찜꽁",
  /** 개인정보 보호책임자 — 법 제31조상 지정·공개가 의무다. */
  privacyOfficer: {
    name: "강민성",
    title: "운영자",
    email: "kk920106@naver.com",
  },
  /** 문의 창구. 보호책임자 메일과 같아도 되지만 자리는 따로 둔다. */
  contactEmail: "kms0902@naver.com",
} as const;

export const TERMS_EFFECTIVE_DATE = "2026년 8월 18일";
export const PRIVACY_EFFECTIVE_DATE = "2026년 8월 18일";
