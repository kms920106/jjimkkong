"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * shadcn's dark palette hangs off a `.dark` class rather than the
 * `prefers-color-scheme` query the app used before it. next-themes is what
 * puts that class on <html>; `defaultTheme="system"` keeps the behaviour the
 * same as it was — the OS decides — while leaving room for a toggle later.
 */
export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // The map SDKs paint their own tiles; a transition on every element
      // while they are mounted is a visible stutter on a phone.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
