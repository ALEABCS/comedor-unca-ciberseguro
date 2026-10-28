const CACHE_NAME = "comedor-unca-static-v2";
const APP_SHELL = [
  "/offline.html",
  "/manifest.webmanifest",
  "/branding/comedor-icon-192.png",
  "/branding/comedor-logo.webp",
  "/branding/unca-wordmark.webp",
  "/branding/exterior-hero.webp"
];
const STATIC_ASSET = /\.(?:css|js|svg|png|webp|woff2?)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name.startsWith("comedor-unca-static-") && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/trpc") || url.pathname.startsWith("/auth") || url.pathname.startsWith("/api")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const offline = await cache.match("/offline.html");
      if (offline) return offline;
      return new Response("Sin conexión.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }));
    return;
  }

  if (STATIC_ASSET.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
  }
});
