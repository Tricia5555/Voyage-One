// VOYAGE ONE — THE COPY ON THE DEVICE (M1033, 1 Nov 2026).
// Keeps Voyage One on the phone so it opens with no signal and saved journeys can be read on a
// plane or abroad. Upload once beside index.html; every later build is picked up automatically.
//
//  • The app page (index.html): network first, so a new build arrives the moment there is a
//    connection; the stored copy is used only when the network fails or stalls.
//  • The code it runs on (React, Babel, icons, fonts from esm.sh, unpkg and Google Fonts): served
//    from the device and refreshed quietly in the background.
//  • Live lookups (/api/…, Supabase, Google, Duffel): never stored — they need the network, and
//    stale prices or availability would be worse than none.
const VERSION = "vo-2026-11-01";
const SHELL = "vo-shell-" + VERSION;
const LIBS = "vo-libs-" + VERSION;
const PRECACHE = [
  "/",
  "/manifest.json",
  "/apple-touch-icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon-32.png",
  "https://unpkg.com/@babel/standalone@7.25.6/babel.min.js",
];
const LIB_HOSTS = ["esm.sh", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const STALL_MS = 7000;   // a stalled connection (plane Wi-Fi) falls back to the stored app after 7s

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // One at a time and forgiving: a single missing icon must not stop the app being stored.
    for (const url of PRECACHE) {
      try {
        const res = await fetch(url, { cache: "reload", mode: url.startsWith("http") ? "cors" : "same-origin" });
        if (res && res.ok) await cache.put(url, res);
      } catch (e) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, LIBS]);
    for (const k of await caches.keys()) if (k.startsWith("vo-") && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isPage = (req, url) => req.mode === "navigate" || (url.origin === self.location.origin && (url.pathname === "/" || url.pathname === "/index.html"));
const isLive = (url) => url.origin === self.location.origin
  ? url.pathname.startsWith("/api/")
  : !LIB_HOSTS.includes(url.hostname);

async function pageFirstFromNetwork(req) {
  const cache = await caches.open(SHELL);
  const stored = await cache.match("/");
  const net = fetch(req).then((res) => {
    if (res && res.ok) cache.put("/", res.clone());
    return res;
  });
  if (!stored) return net;
  // Network wins when it answers in time; a dead or stalled connection gets the stored app.
  const stall = new Promise((resolve) => setTimeout(() => resolve(stored), STALL_MS));
  try { return await Promise.race([net.catch(() => stored), stall]); } catch (e) { return stored; }
}

async function libFromDevice(req) {
  const cache = await caches.open(LIBS);
  const stored = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (stored) return stored;
  const res = await refresh;
  if (res) return res;
  // The shell cache may hold Babel from the install step.
  const shell = await caches.open(SHELL);
  return (await shell.match(req.url)) || Response.error();
}

async function sameOriginStatic(req) {
  const cache = await caches.open(SHELL);
  const stored = await cache.match(req);
  if (stored) return stored;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) { return Response.error(); }
}

// FIRST VISIT (M1033). The page loads its code before this file is running, so it tells us what it
// loaded and we store those too — one online visit is enough to work offline.
self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type !== "vo-store" || !Array.isArray(d.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(LIBS);
    for (const u of d.urls.slice(0, 200)) {
      try {
        const url = new URL(u);
        if (!LIB_HOSTS.includes(url.hostname) || await cache.match(u)) continue;
        const res = await fetch(u, { mode: "cors" });
        if (res && res.ok) await cache.put(u, res);
      } catch (e) {}
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (isPage(req, url)) { event.respondWith(pageFirstFromNetwork(req)); return; }
  if (isLive(url)) return;                                   // straight to the network, never stored
  if (url.origin === self.location.origin) { event.respondWith(sameOriginStatic(req)); return; }
  event.respondWith(libFromDevice(req));
});
