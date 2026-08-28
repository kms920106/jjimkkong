/**
 * Minimal ambient declarations for the three map SDKs. Each provider ships its
 * own @types package, but they conflict on the shared `google` namespace and
 * pull in far more surface than three marker-and-bounds components need — so
 * only the members actually used here are declared.
 */

declare namespace naver.maps {
  class LatLng {
    constructor(lat: number, lng: number);
  }
  class LatLngBounds {
    constructor(sw: LatLng, ne: LatLng);
    extend(latlng: LatLng): void;
  }
  class Map {
    constructor(
      element: HTMLElement | string,
      options?: { center?: LatLng; zoom?: number },
    );
    setCenter(latlng: LatLng): void;
    panTo(
      latlng: LatLng,
      transitionOptions?: { duration?: number; easing?: string },
    ): void;
    getZoom(): number;
    setZoom(zoom: number): void;
    fitBounds(bounds: LatLngBounds): void;
    destroy(): void;
  }
  class Size {
    constructor(width: number, height: number);
  }
  class Point {
    constructor(x: number, y: number);
  }
  /**
   * An HTML marker: `content` replaces the default pin entirely, and `anchor`
   * is the point *within* that content placed on the coordinate — so a label
   * with a stem at the bottom anchors at (width/2, height).
   */
  type HtmlIcon = {
    content: string;
    size?: Size;
    anchor?: Point;
  };
  class Marker {
    constructor(options: {
      position: LatLng;
      map: Map;
      title?: string;
      icon?: HtmlIcon;
      zIndex?: number;
    });
    setMap(map: Map | null): void;
    setIcon(icon: HtmlIcon): void;
    setZIndex(zIndex: number): void;
  }
  namespace Event {
    function addListener(
      target: object,
      event: string,
      handler: () => void,
    ): void;
    function clearInstanceListeners(target: object): void;
  }
}

declare namespace kakao.maps {
  function load(callback: () => void): void;
  class LatLng {
    constructor(lat: number, lng: number);
  }
  class LatLngBounds {
    extend(latlng: LatLng): void;
    isEmpty(): boolean;
  }
  class Map {
    constructor(element: HTMLElement, options: { center: LatLng; level?: number });
    setCenter(latlng: LatLng): void;
    panTo(latlng: LatLng): void;
    getLevel(): number;
    setLevel(
      level: number,
      options?: { animate?: boolean; anchor?: LatLng },
    ): void;
    /**
     * The padding arguments are optional in the SDK; without them the
     * bounds sit flush against the viewport edge and markers on the
     * boundary render half off-screen.
     */
    setBounds(
      bounds: LatLngBounds,
      paddingTop?: number,
      paddingRight?: number,
      paddingBottom?: number,
      paddingLeft?: number,
    ): void;
  }
  class Marker {
    constructor(options: { position: LatLng; title?: string });
    setMap(map: Map | null): void;
  }
  /**
   * Kakao's only HTML marker: `kakao.maps.Marker` takes an image, never markup.
   *
   * `xAnchor`/`yAnchor` are fractions of the content box (0–1, default 0.5), so
   * `{ x: 0.5, y: 1 }` puts the coordinate at the bottom centre. `clickable`
   * stops a tap on the content from also panning the map.
   *
   * Note there is no `addListener` here and none in the SDK — a CustomOverlay
   * is not an event target, so clicks are DOM listeners on the content element.
   */
  class CustomOverlay {
    constructor(options: {
      position: LatLng;
      content: string | HTMLElement;
      map?: Map | null;
      xAnchor?: number;
      yAnchor?: number;
      zIndex?: number;
      clickable?: boolean;
    });
    setMap(map: Map | null): void;
    setContent(content: string | HTMLElement): void;
    getContent(): string | HTMLElement;
    setZIndex(zIndex: number): void;
  }
  namespace event {
    function addListener(
      target: object,
      event: string,
      handler: () => void,
    ): void;
    function removeListener(
      target: object,
      event: string,
      handler: () => void,
    ): void;
  }
}

declare namespace google.maps {
  class LatLngBounds {
    extend(latlng: { lat: number; lng: number }): void;
    isEmpty(): boolean;
  }
  class Map {
    constructor(
      element: HTMLElement,
      options: {
        center: { lat: number; lng: number };
        zoom: number;
        mapTypeControl?: boolean;
        streetViewControl?: boolean;
        /**
         * Required by AdvancedMarkerElement — without it the markers never
         * render, silently. `DEMO_MAP_ID` works for development; production
         * needs a real Map ID from the Cloud console.
         */
        mapId?: string;
      },
    );
    setCenter(latlng: { lat: number; lng: number }): void;
    panTo(latlng: { lat: number; lng: number }): void;
    getZoom(): number | undefined;
    setZoom(zoom: number): void;
    fitBounds(bounds: LatLngBounds, padding?: number): void;
  }
  class Marker {
    constructor(options: {
      position: { lat: number; lng: number };
      map: Map;
      title?: string;
    });
    setMap(map: Map | null): void;
    addListener(event: string, handler: () => void): void;
  }
  namespace event {
    function clearInstanceListeners(instance: object): void;
  }
  /**
   * The replacement for `google.maps.Marker`, which is deprecated as of v3.56
   * (2024-02-21) and cannot take DOM content. Loaded via `libraries=marker`;
   * requires `mapId` on the map.
   */
  namespace marker {
    class AdvancedMarkerElement {
      constructor(options: {
        position: { lat: number; lng: number };
        map?: Map | null;
        title?: string;
        content?: HTMLElement;
        zIndex?: number;
        /**
         * Required for the `gmp-click` event, and it also makes the marker
         * keyboard-focusable and announced by screen readers with its `title`.
         */
        gmpClickable?: boolean;
      });
      map: Map | null;
      content: HTMLElement | null;
      zIndex: number | null;
      addEventListener(event: string, handler: () => void): void;
    }
  }
}

interface Window {
  naver: typeof naver;
  kakao: typeof kakao;
  google: typeof google;
}
