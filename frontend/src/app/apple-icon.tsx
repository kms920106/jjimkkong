import { ImageResponse } from "next/og";

/** 180x180 is what iOS wants for a Home Screen icon. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Deliberately opaque and un-rounded: iOS composites Home Screen icons over
 * black and applies its own corner mask, so an alpha channel or a hand-drawn
 * radius shows up as dark fringing inside the system's rounding.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#252525",
          color: "#fafafa",
          fontSize: 116,
        }}
      >
        찜
      </div>
    ),
    { ...size },
  );
}
