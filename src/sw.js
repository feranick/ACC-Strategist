// ═══════════════════════════════════════════════════════════
// ACC Strategist — Service Worker (Offline Support)
// ═══════════════════════════════════════════════════════════

const APP_VER = new URL(self.location).searchParams.get('v') || 'unknown';
const CACHE_VERSION = 'acc-strategist-v' + APP_VER;

// Files to cache for full offline support
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './icon.ico',
    './icon.png',
    './icon192.png',
    // Google Fonts (cached on first load via runtime caching below)
];

// External CDN URLs we want to cache at runtime
const CDN_HOSTS = [
    'cdn.tailwindcss.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

// ───────────────────────────────────────────────────────────
// INSTALL: Precache core app shell
// ───────────────────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => {
                console.log('[SW] Precaching app shell');
                return cache.addAll(PRECACHE_URLS);
            })
            .then(() => self.skipWaiting()) // Activate immediately
    );
});

// ───────────────────────────────────────────────────────────
// ACTIVATE: Clean up old caches
// ───────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_VERSION)
                    .map(name => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim()) // Take control of all pages
    );
});

// ───────────────────────────────────────────────────────────
// FETCH: Stale-While-Revalidate for CDN, Cache-First for app
// ───────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip chrome-extension and other non-http(s) schemes
    if (!url.protocol.startsWith('http')) return;

    // CDN resources: Stale-While-Revalidate
    // Serve from cache immediately, but update cache in background
    if (CDN_HOSTS.some(host => url.hostname.includes(host))) {
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }

    // App resources: Cache-First, fallback to network
    if (url.origin === location.origin) {
        event.respondWith(cacheFirst(event.request));
        return;
    }
});

// ───────────────────────────────────────────────────────────
// STRATEGIES
// ───────────────────────────────────────────────────────────

// Cache-First: Try cache, fall back to network, cache the response
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        // If both cache and network fail, return offline fallback
        return offlineFallback();
    }
}

// Stale-While-Revalidate: Return cache immediately, update in background
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);

    // Fetch fresh copy in background
    const fetchPromise = fetch(request)
        .then(response => {
            if (response.ok) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => cached); // If network fails, fall back to cached

    // Return cached immediately if available, otherwise wait for network
    return cached || fetchPromise;
}

// Minimal offline fallback page (only if everything fails)
function offlineFallback() {
    return new Response(
        `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ACC Strategist — Offline</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    background: #0d1117; color: #c9d1d9;
                    display: flex; align-items: center; justify-content: center;
                    min-height: 100vh; margin: 0; text-align: center;
                }
                .box {
                    padding: 2rem; border: 1px solid #30363d;
                    border-radius: 1rem; background: #161b22; max-width: 400px;
                }
                h1 { color: #58a6ff; }
                button {
                    margin-top: 1rem; padding: 0.75rem 1.5rem;
                    background: #238636; color: white; border: none;
                    border-radius: 0.5rem; cursor: pointer; font-size: 1rem;
                }
                button:hover { background: #2ea043; }
            </style>
        </head>
        <body>
            <div class="box">
                <h1>Offline</h1>
                <p>ACC Strategist could not load. Please check your connection and try again.</p>
                <button onclick="location.reload()">Retry</button>
            </div>
        </body>
        </html>`,
        {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/html' }
        }
    );
}

// ───────────────────────────────────────────────────────────
// MESSAGE: Allow manual cache clear from app
// ───────────────────────────────────────────────────────────
self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data === 'CLEAR_CACHE') {
        caches.keys().then(names => {
            names.forEach(name => caches.delete(name));
        });
    }
});
