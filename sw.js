// サカミチア サービスワーカー（PWA）
// 方針：HTML と data/*.json は network-first（毎日更新されるので古いキャッシュを見せ続けない）。
// 静的アセット（CSS/JS/画像など）だけ cache-first。対象は同一オリジンの GET のみ。
const VERSION = "v1";
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
  if (isStaticAsset(url)) {
    e.respondWith(cacheFirst(req));
    return;
  }
  e.respondWith(networkFirst(req, RUNTIME_CACHE));
});
