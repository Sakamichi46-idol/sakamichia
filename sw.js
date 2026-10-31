// サカミチア サービスワーカー（PWA）
// 方針：HTML と data/*.json は network-first（毎日更新されるので古いキャッシュを見せ続けない）。
// JS/CSS は stale-while-revalidate（キャッシュを即返しつつ裏で新版に更新し、次回表示から最新化）。
// その他の静的アセット（画像など）は cache-first。対象は同一オリジンの GET のみ。
const VERSION = "v2";
const STATIC_CACHE = "sakamichia-static-" + VERSION;
const RUNTIME_CACHE = "sakamichia-runtime-" + VERSION;

self.addEventListener("install", (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith("sakamichia-") && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/assets/")
    || /\.(?:css|js|png|jpe?g|gif|webp|svg|ico|woff2?)$/i.test(url.pathname);
}

function isScriptOrStyle(url) {
  return /\.(?:css|js)$/i.test(url.pathname);
}

function networkFirst(req, cacheName) {
  return fetch(req)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(cacheName).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req, { ignoreSearch: false }));
}

function cacheFirst(req) {
  return caches.match(req).then((hit) => {
    if (hit) return hit;
    return fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
      }
      return res;
    });
  });
}

// キャッシュがあれば即返し、裏でネットワークから新版を取得してキャッシュを更新する。
// JS/CSS は機能追加のたびに変わるため、cache-first だと古い版が残り続ける問題への対策。
function staleWhileRevalidate(req) {
  return caches.open(STATIC_CACHE).then((cache) =>
    cache.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 外部ドメイン（オンライン対戦Worker等）には介入しない
  if (url.pathname.startsWith("/data/") || req.mode === "navigate"
      || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    e.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }
  if (isScriptOrStyle(url)) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (isStaticAsset(url)) {
    e.respondWith(cacheFirst(req));
    return;
  }
  e.respondWith(networkFirst(req, RUNTIME_CACHE));
});
