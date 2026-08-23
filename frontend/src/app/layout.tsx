import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ThemeProvider from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "찜꽁",
  description: "인스타그램·유튜브 링크를 붙여넣으면 장소를 지도에 저장합니다.",
  // The service is used from the iOS Home Screen, so declare it: without this
  // the same launcher entry opens inside Safari chrome instead of standalone.
  appleWebApp: {
    capable: true,
    title: "찜꽁",
    // Not `black-translucent`, which pushes content under the status bar. This
    // app's layouts do not reserve room for it, so the header would sit beneath
    // the clock.
    statusBarStyle: "default",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: next-themes writes the theme class onto <html>
    // before React hydrates, so the server markup never matches here.
    <html
      lang="ko"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          {/* Sonner labels its region "Notifications" by default, which a
              screen reader would read out in English. The close label sits on
              toastOptions rather than here — it is a per-toast option. */}
          <Toaster containerAriaLabel="알림" position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
