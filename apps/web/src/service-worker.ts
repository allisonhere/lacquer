/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';
const worker = self as unknown as ServiceWorkerGlobalScope;
const cacheName = `lacquer-static-${version}`;
const assets = new Set([...build, ...files]);
worker.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(cacheName).then((cache) => cache.addAll([...assets])),
  );
});
worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith('lacquer-static-') && key !== cacheName,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
// Cache only public build/static assets. Never cache HTML, auth, tenant data, or API responses.
worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== worker.location.origin ||
    !assets.has(url.pathname)
  )
    return;
  event.respondWith(
    caches
      .open(cacheName)
      .then(
        async (cache) =>
          (await cache.match(event.request)) ?? fetch(event.request),
      ),
  );
});
