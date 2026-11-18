// Service worker Suivi Thermique v2
// - Page et scripts de l'application : réseau d'abord (toujours la dernière version en ligne),
//   copie en cache pour fonctionner hors ligne dans la cour.
// - Bibliothèques externes (versions figées) : cache d'abord.
// - API (Supabase, météo) et fonds de carte : jamais mis en cache ici.
const VERSION = '2.2.0';
const CACHE = 'suivi-thermique-' + VERSION;

const FICHIERS_APP = ['./', './index.html', './meteo.js?v=2.2.0', './manifest.json', './iconTherm.png'];
const BIBLIOTHEQUES = [
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.js',
    'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
    'https://cdn.plot.ly/plotly-2.27.0.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
    'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css',
    'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js'
];
const HOTES_BIBLIOTHEQUES = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'cdn.sheetjs.com', 'cdn.plot.ly', 'cdnjs.cloudflare.com', 'unpkg.com'];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await Promise.allSettled(FICHIERS_APP.map((u) => cache.add(u)));
        await Promise.allSettled(BIBLIOTHEQUES.map(async (u) => {
            const r = await fetch(new Request(u, { mode: 'no-cors' }));
            await cache.put(u, r);
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const noms = await caches.keys();
        await Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // Fichiers de l'application : réseau d'abord, cache en secours
    if (url.origin === self.location.origin) {
        event.respondWith((async () => {
            try {
                // « no-cache » : toujours revalider auprès de GitHub Pages (évite un mélange d'anciens et nouveaux fichiers)
                const r = await fetch(req, { cache: 'no-cache' });
                if (r && r.ok) {
                    const cache = await caches.open(CACHE);
                    cache.put(req, r.clone());
                }
                return r;
            } catch (e) {
                const enCache = await caches.match(req, { ignoreSearch: true });
                if (enCache) return enCache;
                if (req.mode === 'navigate') return caches.match('./');
                throw e;
            }
        })());
        return;
    }

    // Bibliothèques : cache d'abord
    if (HOTES_BIBLIOTHEQUES.includes(url.hostname)) {
        event.respondWith((async () => {
            const enCache = await caches.match(req);
            if (enCache) return enCache;
            const r = await fetch(req);
            const cache = await caches.open(CACHE);
            cache.put(req, r.clone());
            return r;
        })());
    }
    // Tout le reste (API Supabase, météo, tuiles de carte) : comportement normal du navigateur
});
