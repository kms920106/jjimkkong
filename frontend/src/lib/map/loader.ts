/**
 * Loads a map provider's JS SDK exactly once per page, even when several
 * components ask for it concurrently or the user toggles providers back and
 * forth. Each provider resolves only when its global is actually usable.
 */
const pending = new Map<string, Promise<void>>();

function injectScript(id: string, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      // `load` is one-shot: if the element already finished, attaching a
      // listener now would never fire and this promise would hang forever.
      // The dataset flags record the settled state so a retry can read it.
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      if (existing.dataset.failed === "true") {
        reject(new Error(`${id} 스크립트를 불러오지 못했습니다.`));
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`${id} 스크립트를 불러오지 못했습니다.`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      script.dataset.failed = "true";
      reject(new Error(`${id} 스크립트를 불러오지 못했습니다.`));
    };
    document.head.appendChild(script);
  });
}

function load(key: string, loader: () => Promise<void>): Promise<void> {
  let promise = pending.get(key);
  if (!promise) {
    // Drop the cached rejection so a transient network failure can be retried.
    promise = loader().catch((error) => {
      pending.delete(key);
      throw error;
    });
    pending.set(key, promise);
  }
  return promise;
}

export function loadNaverMaps(): Promise<void> {
  return load("naver", async () => {
    const keyId = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;
    if (!keyId) throw new Error("NEXT_PUBLIC_NAVER_MAP_CLIENT_ID가 없습니다.");
    await injectScript(
      "naver-maps-sdk",
      `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${keyId}`,
    );
    // An unauthorized key still returns 200 with a body that never defines the
    // namespace, so the load event alone does not mean the SDK is usable.
    if (!window.naver?.maps) {
      throw new Error(
        "네이버 지도 SDK를 초기화하지 못했습니다. 인증 키와 등록된 도메인을 확인해 주세요.",
      );
    }
  });
}

export function loadKakaoMaps(): Promise<void> {
  return load("kakao", async () => {
    const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
    if (!appKey) throw new Error("NEXT_PUBLIC_KAKAO_MAP_KEY가 없습니다.");
    await injectScript(
      "kakao-maps-sdk",
      `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`,
    );
    if (!window.kakao?.maps?.load) {
      throw new Error(
        "카카오맵 SDK를 초기화하지 못했습니다. 앱 키와 등록된 도메인을 확인해 주세요.",
      );
    }
    // With autoload=false the SDK only defines kakao.maps.load; the namespace
    // is not usable until that callback fires.
    await new Promise<void>((resolve) => window.kakao.maps.load(resolve));
  });
}

export function loadGoogleMaps(): Promise<void> {
  return load("google", async () => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    if (!key) throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_KEY가 없습니다.");
    // `libraries=marker` is required for AdvancedMarkerElement, the replacement
    // for the deprecated google.maps.Marker and the only Google marker that
    // takes DOM content. Without it `google.maps.marker` is undefined and the
    // pins never appear.
    await injectScript(
      "google-maps-sdk",
      `https://maps.googleapis.com/maps/api/js?key=${key}&language=ko&region=KR&libraries=marker`,
    );
    if (!window.google?.maps) {
      throw new Error(
        "구글 지도 SDK를 초기화하지 못했습니다. API 키와 허용 도메인을 확인해 주세요.",
      );
    }
    // Checked separately: an authorized key still loads the core namespace when
    // the marker library fails to come with it, and the failure would otherwise
    // surface as a map with no pins and nothing in the console.
    if (!window.google.maps.marker) {
      throw new Error(
        "구글 지도 마커 라이브러리를 불러오지 못했습니다. API 키의 Maps JavaScript API 사용 설정을 확인해 주세요.",
      );
    }
  });
}
