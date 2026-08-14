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
  class Marker {
    constructor(options: { position: LatLng; map: Map; title?: string });
    setMap(map: Map | null): void;
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
    setBounds(bounds: LatLngBounds): void;
  }
  class Marker {
    constructor(options: { position: LatLng; title?: string });
    setMap(map: Map | null): void;
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
}

interface Window {
  naver: typeof naver;
  kakao: typeof kakao;
  google: typeof google;
}
