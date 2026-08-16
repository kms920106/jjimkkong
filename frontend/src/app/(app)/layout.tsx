/**
 * No shared chrome: the home page is a fullscreen map that floats its own
 * hamburger and + buttons, and every other page brings its own header and
 * width container.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <main className="flex-1">{children}</main>;
}
