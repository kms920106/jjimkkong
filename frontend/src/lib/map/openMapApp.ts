import type { MapTarget } from "@/lib/map/externalLinks";

/**
 * How long to wait for the native app to take over before deciding it is not
 * installed. Long enough that a cold app launch on an older phone still wins
 * the race, short enough that a user with no Naver Maps is not left staring at
 * an unchanged screen.
 */
const FALLBACK_DELAY_MS = 1500;

/**
 * Hand a `scheme` target to the native app, keeping this page mounted.
 *
 * Why this exists: on iOS this app is used from the Home Screen (standalone),
 * where a cross-origin `target="_blank"` does not open Safari — it drops an
 * in-app browser sheet over the app — and a plain https link to a domain with
 * no Universal Link navigates our own window away. A custom scheme does
 * neither: iOS hands it to the OS, our page stays alive in the app switcher,
 * and returning lands the user back on the post they were reading.
 *
 * A `url` target needs none of this and gets none of it: Universal Links
 * already behave that way (that is why the Instagram button was always fine),
 * and intercepting one would only take away iOS's own graceful degradation to
 * the web page. So this returns false and the anchor's default action runs.
 *
 * The scheme cannot degrade by itself, though — with the app missing, nothing
 * happens — hence the timer. `visibilitychange`/`pagehide` firing means the app
 * did launch and we cancel; if neither fires the app is absent and we send the
 * user to the web map. Deliberately not `blur`, which is unreliable inside a
 * standalone web view.
 *
 * @returns whether the click was handled here (the caller should preventDefault).
 */
/**
 * The one attempt still waiting on its timer, if any.
 *
 * A post can list six places, so two 네이버맵 chips sit within a thumb's width
 * of each other. Tapping the second while the first is still armed would leave
 * two live timers, and with the app missing both would assign
 * `location.href` — the user tapped B last and could land on A's map. Each new
 * attempt supersedes the previous one.
 */
let inFlight: (() => void) | null = null;

export function openMapApp(target: MapTarget): boolean {
  if (target.kind === "url") return false;

  // Must run inside the user-gesture handler that called us. Deferring the
  // assignment (a promise, a timeout) makes iOS ignore the scheme navigation.
  const { scheme, fallback } = target;

  inFlight?.();

  let settled = false;
  const cancel = () => {
    if (settled) return;
    settled = true;
    if (inFlight === cancel) inFlight = null;
    window.clearTimeout(timer);
    // `visibilitychange` must be bound to `document`, not `window`: the event
    // does not bubble (verified), so a window-level listener never fires and
    // the fallback would navigate away *even when the app did launch* —
    // exactly the bug this whole module exists to prevent.
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onHide);
  };
  // Only backgrounding counts as proof the app launched: `visibilitychange`
  // also fires on the way *back*, when the document becomes visible again.
  const onHide = () => {
    if (document.visibilityState === "hidden") cancel();
  };

  const timer = window.setTimeout(() => {
    if (settled) return;
    cancel();
    window.location.href = fallback;
  }, FALLBACK_DELAY_MS);

  inFlight = cancel;
  document.addEventListener("visibilitychange", onHide);
  // `pagehide` does fire on window, and Safari has historically delivered it
  // where visibilitychange did not.
  window.addEventListener("pagehide", onHide);

  // Not a hidden iframe: WebKit blocks non-http(s) navigation started from an
  // iframe on current iOS, and that trick has been unreliable since iOS 9.
  window.location.href = scheme;
  return true;
}
