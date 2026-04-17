/**
 * Service Worker — Iconic Billing
 * Strategy:
 *  - HTML (index.html): NETWORK-FIRST — always fetches fresh on load, falls back to cache
 *  - CSS/JS:            NETWORK-FIRST with cache fallback (updates immediately on deploy)
 *  - API calls:         Always network, never cached
 *  - Offline billing:   Queues POST /api/billing/submit in IndexedDB, replays on reconnect
 *
 * Cache version: bump this string on every deploy to force old caches to clear.
 * Currently set to a timestamp that changes each build.
 */
const CACHE_NAME = 'ib-v' + '20260413';
const QUEUE_KEY  = 'ib-offline-queue';

// ── Install: pre-cache nothing (network-first means we don't need pre-caching) ──
self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

// ── Activate: delete ALL old caches immediately ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for everything except offline billing queue ──
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = request.url;

  // Offline billing queue: intercept POST submissions
  if (request.method === 'POST' && url.includes('/api/billing/submit')) {
    e.respondWith(
      fetch(request.clone()).catch(async () => {
        const body = await request.clone().text();
        const queue = await getQueue();
        queue.push({ url, body, timestamp: Date.now() });
        await saveQueue(queue);
        return new Response(
          JSON.stringify({ ok: true, queued: true, rowCount: 1 }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Never cache API calls or external resources
  if (request.method !== 'GET') return;
  if (url.includes('/api/')) return;
  if (url.includes('googleapis.com')) return;
  if (url.includes('fonts.g')) return;

  // NETWORK-FIRST for all app files: try network, fall back to cache
  // This means updates are always picked up immediately
  e.respondWith(
    fetch(request)
      .then(response => {
        // Cache the fresh response for offline fallback only
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ── Notify all open tabs when a new SW activates (triggers reload prompt) ──
self.addEventListener('activate', () => {
  self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
  });
});

// ── Background sync: replay queued billing when back online ──
self.addEventListener('sync', e => {
  if (e.tag === 'replay-billing') e.waitUntil(replayQueue());
});

async function getQueue()   { const db = await openDB(); return (await db.get(QUEUE_KEY)) || []; }
async function saveQueue(q) { const db = await openDB(); return db.set(QUEUE_KEY, q); }

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('ib-db', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onsuccess = e => {
      const db = e.target.result;
      res({
        get: k  => new Promise(r => { const t=db.transaction('kv','readonly'); t.objectStore('kv').get(k).onsuccess=ev=>r(ev.target.result); }),
        set: (k,v) => new Promise(r => { const t=db.transaction('kv','readwrite'); t.objectStore('kv').put(v,k).onsuccess=r; }),
      });
    };
    req.onerror = rej;
  });
}

async function replayQueue() {
  const queue = await getQueue();
  if (!queue.length) return;
  const remaining = [];
  for (const item of queue) {
    try {
      const r = await fetch(item.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: item.body,
      });
      if (!r.ok) remaining.push(item);
    } catch (_) { remaining.push(item); }
  }
  await saveQueue(remaining);
}
