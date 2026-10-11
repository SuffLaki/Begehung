// Nur für die lokale Vorschau: ersetzt einen alten Service Worker, löscht dessen
// Zwischenspeicher und lädt geöffnete Fenster neu – danach ist die Vorschau aktuell.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
