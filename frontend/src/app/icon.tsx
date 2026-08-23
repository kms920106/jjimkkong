import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Generated rather than a committed file: the repo has no icon asset, and a
 * single glyph on a solid tile does not need one. `apple-icon.tsx` is the same
 * mark at Home Screen size.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // The light theme's --foreground / --primary, so the tab icon reads
          // as the same mark as the app.
          background: "#252525",
          color: "#fafafa",
          fontSize: 22,
        }}
      >
        찜
      </div>
    ),
    { ...size },
  );
}
