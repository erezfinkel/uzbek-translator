// Offline support: app shell + phrasebook audio are cached on first visit.
const CACHE = 'az-translator-v3';
const SHELL = ['./', 'index.html', 'style.css', 'script.js', 'phrases.json'];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll(SHELL);
        const groups = await (await fetch('phrases.json')).json();
        const audio = groups.flatMap(g => g.items.flatMap(i => [`audio/${i.id}-az.mp3`, `audio/${i.id}-ru.mp3`]));
        await cache.addAll(audio);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // Fonts: cache after first load so the page looks the same offline
    if (url.host.includes('fonts.googleapis.com') || url.host.includes('fonts.gstatic.com')) {
        event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
            return res;
        })));
        return;
    }

    // Translation / TTS go straight to the network
    if (url.origin !== self.location.origin) return;

    // Audio never changes: cache first
    if (url.pathname.includes('/audio/')) {
        event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
        return;
    }

    // App files: network first so updates arrive, cache when offline
    event.respondWith(fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
});
