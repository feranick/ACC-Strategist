// ═══════════════════════════════════════════════════════════
// ACC Strategist — Service Worker (Offline Support)
//
// Strategy overview:
//  - Navigations (index.html): NETWORK-FIRST, cache fallback.
//    This guarantees users pick up new app versions when online,
//    while still working fully offline. (Cache-first navigations
//    previously deadlocked the update mechanism.)
//  - Same-origin static assets: cache-first.
//  - CDN assets (Tailwind, Chart.js, Google Fonts):
//    stale-while-revalidate. Chart.js (cdn.jsdelivr.net) is now
//    included so charts work offline.
//  - No skipWaiting() on install: the in-app "Update Available"
//    banner controls activation via the SKIP_WAITING message.
// ═══════════════════════════════════════════════════════════

const APP_VER = new URL(self.location.href).searchParams.get('v') || '0';
const CACHE_VERSION = 'acc-strategist-v' + APP_VER;

// Critical app shell — install fails if these can't be cached
const PRECACHE_CRITICAL = [
    './',
    './index.html',
    './manifest.json'
];

// Nice-to-have assets — cached individually; a missing icon
// must not break the entire install (cache.addAll is all-or-nothing)
const PRECACHE_OPTIONAL = [
    './images/favicon.ico',
    './images/icon.png',
    './images/icon192.png'
];

// External CDN hosts cached at runtime (exact host or subdomain match)
const CDN_HOSTS = [
    'cdn.tailwindcss.com',
    'cdn.jsdelivr.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

function isCdnHost(hostname) {
    // Exact or proper-subdomain match. Avoids the substring trap where
    // "cdn.tailwindcss.com.evil.example" would match includes().
    return CDN_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
}

// ───────────────────────────────────────────────────────────
// INSTALL: Precache app shell (no skipWaiting — banner-driven)
// ───────────────────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(async cache => {
            await cache.addAll(PRECACHE_CRITICAL);
            // Optional assets: best effort, never fail the install
            await Promise.all(
                PRECACHE_OPTIONAL.map(url =>
                    cache.add(url).catch(err =>
                        console.warn('[SW] Optional precache failed:', url, err)
                    )
                )
            );
        })
    );
});

// ───────────────────────────────────────────────────────────
// ACTIVATE: Clean up old caches, take control
// ───────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names
                    .filter(name => name.startsWith('acc-strategist-') && name !== CACHE_VERSION)
                    .map(name => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            ))
            .then(() => self.clients.claim())
    );
});

// ───────────────────────────────────────────────────────────
// FETCH
// ───────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    let url;
    try { url = new URL(request.url); } catch (e) { return; }
    if (!url.protocol.startsWith('http')) return;

    // Navigations: network-first so updates always reach users
    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    // CDN resources: stale-while-revalidate
    if (isCdnHost(url.hostname)) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    // Same-origin static assets: cache-first
    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(request));
        return;
    }
    // Everything else: let the browser handle it normally
});

// ───────────────────────────────────────────────────────────
// STRATEGIES
// ───────────────────────────────────────────────────────────

async function networkFirstNavigation(request) {
    const cache = await caches.open(CACHE_VERSION);
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            cache.put(request, response.clone());
            // Keep './' fresh too, so cold offline starts work
            cache.put('./', response.clone());
        }
        return response;
    } catch (err) {
        const cached = await cache.match(request) || await cache.match('./index.html') || await cache.match('./');
        return cached || offlineFallback();
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        // Non-navigation asset failed: return a network error, NOT an
        // HTML offline page (a failed image fetch must not receive HTML)
        return Response.error();
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);

    const fetchPromise = fetch(request)
        .then(response => {
            // Cache successful and opaque (no-cors) responses
            if (response && (response.ok || response.type === 'opaque')) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => cached);

    return cached || fetchPromise;
}

// Minimal offline fallback page — navigations only
function offlineFallback() {
    return new Response(
        `<!DOCTYPE html>
        <html lang="en">
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
// MESSAGE: update activation & manual cache clear
// ───────────────────────────────────────────────────────────
self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data === 'CLEAR_CACHE') {
        // waitUntil so the SW isn't terminated mid-cleanup
        event.waitUntil(
            caches.keys().then(names =>
                Promise.all(names.map(name => caches.delete(name)))
            )
        );
    }
});
