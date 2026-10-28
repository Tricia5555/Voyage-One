// api/rooms.js — the hotel's own rooms, drawn from the hotel's own website (M972; browser fallback M974; puppeteer pairing M976; hosted browser M977; token diagnostics M978; longer answers + salvage M979; numbered images M980; booking link M985; the hotel's own menu first + a real rooms-page test M995; www-blind hostnames + redirect-to-home means no page M996; a hollow page is read again in the browser M997; own /reservations/ booking link M1002; big-group booking links M1011; hollow menu pages opened in the browser before judging M1013; hard 50 s answer + browser budget M1014; the hotel's own pages before the group's M1015; the parent list page first + straight to the browser on a 403 site M1016; SynXis links by signature M1018; the Supabase rooms store M1019; list pages first on a refusing site M1020; the menu's list page before guesses M1021; finishes in the background after answering M1022; reading marker + the rooms stretch of a big page M1023; store trail + background failures noted M1024; one browser session per request M1025, 27 Oct 2026).
//
// M974: plain requests from our server were refused by Four Seasons and the Lotte alike
// ("unreachable") — luxury hotel sites sit behind bot protection that turns away anything that
// is not a real browser. So when the plain request fails, the page is opened in the same
// server-side browser the rates reader uses, which passes those checks and also renders pages
// built in JavaScript. ?debug=1 lists every address tried and what came back.
//
// The client chooses a room ON VOYAGE ONE — names, sizes, beds, occupancy and the hotel's own
// photographs — and never has to visit the hotel's site. This function fetches the hotel's
// accommodation page on our server, reduces it to readable text with its image and link
// addresses, and has the same model that powers Help extract the room list as JSON. One method
// for every brand and every independent: no per-site parser to break when a page is redesigned.
//
// GET /api/rooms?hotel=<name>&site=<hotel website>
// Returns: { ok:true, hotel, source, fetched, rooms:[{ name, category, size, beds, occupancy,
//            view, description, images:[url], url }] }
// Cached at the edge for 30 days (rooms change rarely; a new suite appears within the month).
// Needs ANTHROPIC_API_KEY (already set for help.js). Without it: { ok:false, reason:"no-key" }.
//
// Universal rules: never invent a room; every value comes from the page or is null; images are
// the hotel's own addresses, served from the hotel's server (if a site blocks hot-linking the
// card falls back to its usual photograph).

import chromiumPkg from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const MODEL = "claude-haiku-4-5-20251001";
const TRIED = [];
// WHERE THE BROWSER RUNS (M977, 25 Oct 2026). Vercel's function image lacks a system library the
// bundled Chromium needs ("libnss3.so"), so the browser is hosted: with BROWSERLESS_TOKEN set in
// Vercel, the readers connect to Browserless (plumbing, like Vercel or Supabase — nothing a
// client sees); without it they still try the bundled browser, which works on hosts that have
// the library. ?debug=1 reports which one answered.
async function openBrowser() {
  const token = (process.env.BROWSERLESS_TOKEN || "").trim();
  if (token) {
    const region = process.env.BROWSERLESS_REGION || "production-sfo";
    const ws = `wss://${region}.browserless.io?token=${encodeURIComponent(token)}&stealth=true&blockAds=true`;
    const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: { width: 1180, height: 1600 } });
    return { browser, via: "browserless" };
  }
  chromiumPkg.setGraphicsMode = false;
  const browser = await puppeteer.launch({ args: chromiumPkg.args, defaultViewport: { width: 1180, height: 1600 }, executablePath: await chromiumPkg.executablePath(), headless: chromiumPkg.headless });
  return { browser, via: "bundled" };
}

// The same page, fetched by a real browser. Used whenever the plain request is refused.
// ONE BROWSER SESSION PER REQUEST (M1025). Each browser read used to connect, open, read and close
// (~8 s of overhead each); a site that refuses plain requests needed three of them and the read
// no longer fit inside one call. The session is opened once and reused; closed at the end.
let SESSION = null;
async function sessionPage() {
  if (SESSION && SESSION.page) return SESSION;
  const opened = await openBrowser();
  const page = await opened.browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  SESSION = { browser: opened.browser, page, via: opened.via };
  return SESSION;
}
async function closeSession() { if (SESSION) { try { await SESSION.browser.close(); } catch (e) {} SESSION = null; } }
async function getWithBrowser(url) {
  try {
    const s = await sessionPage();
    const resp = await s.page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    try { await s.page.waitForNetworkIdle({ idleTime: 600, timeout: 6000 }); } catch (e) {}
    await new Promise((r) => setTimeout(r, 800));
    const html = await s.page.content();
    const finalUrl = s.page.url();
    TRIED.push({ url, via: "browser:" + s.via, status: resp ? resp.status() : null, bytes: html.length });
    return html && html.length > 500 ? { url: finalUrl, html, via: "browser" } : null;
  } catch (e) {
    TRIED.push({ url, via: "browser", hosted: !!(process.env.BROWSERLESS_TOKEN || "").trim(), error: String(e && e.message || e).slice(0, 700) });
    await closeSession();
    return null;
  }
}
const UA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ROOM_PATHS = ["/accommodations", "/rooms-suites", "/rooms-and-suites", "/rooms", "/accommodation", "/stay", "/suites", "/en/rooms", "/en/accommodations", "/villas"];

async function get(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
    const ct = r.headers.get("content-type") || "";
    TRIED.push({ url, via: "fetch", status: r.status, type: ct.slice(0, 40) });
    if (r.ok && /html/i.test(ct)) { const html = await r.text(); if (html.length > 500) return { url: r.url, html, via: "fetch" }; }
    if (r.status === 404) return null;              // a real "no such page": no point opening a browser on it
  } catch (e) { TRIED.push({ url, via: "fetch", error: String(e && e.message || e).slice(0, 120) }); }
  return await getWithBrowser(url);
}
function abs(base, href) { try { return new URL(href, base).toString(); } catch (e) { return null; } }
// HTML → readable text keeping image addresses and links, so the reader can tie photos to rooms.
// Images are numbered as they are kept, so the reader can refer to "image 7" and the server
// restores the exact address — long addresses were being abbreviated when copied (M980).
const IMAGES = [];
function distill(html, base) {
  IMAGES.length = 0;
  let h = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<noscript>/gi, "").replace(/<\/noscript>/gi, "");
  h = h.replace(/<img\b[^>]*>/gi, (tag) => {
    // Prefer a plain src; fall back to a srcset. A srcset is a comma-separated LIST, so only
    // there is a comma a separator — an address itself may contain commas (Four Seasons' do).
    const plain = /\b(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const set = /\b(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag);
    let u = plain ? plain[1].trim() : set ? set[1].trim().split(/\s+\d+[wx]\s*,?\s*|,\s+(?=\S+\s+\d+[wx])/)[0].trim().split(/\s+/)[0] : "";
    if (!u || /^data:/.test(u)) return " ";
    u = abs(base, u); if (!u) return " ";
    if (/\.svg(\?|$)|\/icons?\/|logo|sprite|pixel|tracking/i.test(u)) return " ";
    IMAGES.push(u);
    return ` [IMG#${IMAGES.length}${alt && alt[1] ? " | " + alt[1].trim() : ""}] `;
  });
  h = h.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi, (tag, href) => { const u = abs(base, href); return u ? ` [LINK ${u}] ` : " "; });
  h = h.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
  h = h.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
  return h.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
// Find the accommodation page: known paths first, then any link on the home page that says rooms.
// Does this page actually show rooms? Not "the word room appears" — Rosewood answered a guessed
// address with its HOME page and a 200, and the word appears there too (M995, 25 Oct 2026). A rooms
// page names several rooms or suites and gives sizes or beds; its own canonical address does not
// point somewhere else.
function looksLikeRooms(got, wanted) {
  const html = got.html || "";
  const canon = (/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html) || /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i.exec(html) || [])[1];
  // Served from somewhere else: the page's canonical address, or the address it redirected to,
  // is the home page or a parent of what we asked for → a missing page dressed as a 200 (M996).
  const norm = (u) => { try { return new URL(u).pathname.replace(/\/+$/, "").toLowerCase() || "/"; } catch (e) { return ""; } };
  if (wanted) {
    const w = norm(wanted);
    for (const actual of [canon, got.url]) {
      if (!actual) continue; const a = norm(actual);
      if (a && w && a !== w && (w.startsWith(a + "/") || a === "/")) return false;
    }
  }
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const heads = (html.match(/<h[1-4][^>]*>[\s\S]*?<\/h[1-4]>/gi) || []).map((x) => x.replace(/<[^>]+>/g, " ").trim()).filter((x) => /\b(room|suite|villa|residence|tent|penthouse|apartment|bungalow|cabin|lodge)\b/i.test(x));
  const sizes = (text.match(/\b\d{2,4}\s?(?:m²|m2|sq\.?\s?m|sq\.?\s?ft|square (?:feet|metres|meters))/gi) || []).length;
  const beds = (text.match(/\b(king|queen|twin|double)\s+bed/gi) || []).length;
  return heads.length >= 3 || (heads.length >= 1 && (sizes >= 2 || beds >= 2)) || sizes >= 4;
}
// Find the accommodation page: THE HOTEL'S OWN MENU FIRST (the link it calls Accommodation, Rooms,
// Suites, Stay, Villas…), then the usual addresses, and only a page that looks like a rooms page.
// The same site with or without "www." — Google often gives the bare host while the hotel's own
// links carry www. (Rosewood, M996). One hostname rule for every hotel.
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./i, "").toLowerCase(); } catch (e) { return ""; } };
const sameSite = (a, b) => host(a) && host(a) === host(b);
async function findRoomsPage(site) {
  const T0 = Date.now(); let browserReads = 0;
  const base = /^https?:\/\//.test(site) ? site : "https://" + site;
  const origin = new URL(base).origin;
  const root = base.replace(/\/+$/, "");
  const tried = new Set();
  // A page the hotel's own menu calls Accommodation/Rooms/Stay that arrives hollow is opened in the
  // browser BEFORE being judged (M1013): script-drawn rooms pages (Mandarin Oriental's /stay) were
  // being rejected as "not a rooms page" on their empty shell.
  const hollow = (got) => { const t = String(got.html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "); return (t.match(/\b\d{2,4}\s?(?:m²|m2|sq\.?\s?m|sq\.?\s?ft)/gi) || []).length + (t.match(/\b(king|queen|twin|double)\s+bed/gi) || []).length < 2; };
  let refusesFetch = false;   // M1016: once a site answers a plain request with 403, read it in the browser directly
  const attempt = async (u, fromMenu) => {
    if (!u || tried.has(u)) return null; tried.add(u);
    try {
      let got = null;
      if (refusesFetch) {
        // M1020: on a site that refuses plain requests, a browser read is spent only on an address
        // that looks like a rooms LIST (not a single room's page), and a 404 refunds it.
        const listLike = !/\/(?:guest_rooms|rooms-suites|accommodations?|suites)\/[^/?#]+\/?$/i.test(new URL(u).pathname) || /\/(?:accommodations?|rooms(?:-and-suites|-suites)?|suites|stay|villas)\/?$/i.test(new URL(u).pathname);
        if (!listLike) { TRIED.push({ url: u, skipped: "a single room's page" }); return null; }
        if (browserReads < 3 && Date.now() - T0 < 35000) { browserReads++; got = await getWithBrowser(u); if (!got && TRIED.length && TRIED[TRIED.length - 1].url === u && TRIED[TRIED.length - 1].status === 404) browserReads--; }
        else { TRIED.push({ url: u, skipped: "browser budget spent" }); return null; }
      }
      else { got = await get(u); if (!got && TRIED.length && TRIED[TRIED.length - 1].url === u && TRIED[TRIED.length - 1].status === 403) { refusesFetch = true; if (browserReads < 3) { browserReads++; got = await getWithBrowser(u); } } }
      if (got && looksLikeRooms(got, u)) return got;
      if (got && fromMenu && hollow(got) && !/^browser/.test(got.via || "") && browserReads < 2 && Date.now() - T0 < 30000) {
        browserReads++;
        TRIED.push({ url: u, note: "menu page arrived hollow — opening in the browser" });
        const again = await getWithBrowser(u);
        if (again && looksLikeRooms(again, u)) return again;
        got = again || got;
      }
      TRIED.push({ url: u, verdict: got ? "not a rooms page" : "no page" });
    } catch (e) {}
    return null;
  };
  let home = null;
  try { home = await get(root); } catch (e) { home = null; }
  if (home && /^browser/.test(home.via || "")) refusesFetch = true;
  if (home) {
    const links = []; const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
    while ((m = re.exec(home.html)) && links.length < 600) {
      const u = abs(home.url, m[1]); if (!u || !sameSite(u, home.url)) continue;
      const txt = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const byText = /^(accommodations?|rooms?(?: (?:&|and) suites)?|suites?(?: (?:&|and) rooms)?|stay|villas?|residences?|tents?|rooms? ?\/ ?suites|guest ?rooms|where to stay|our rooms|the rooms)$/i.test(txt);
      const byUrl = /(^|\/)(accommodations?|rooms?(?:-and-suites|-suites)?|suites?|stay|villas?|tents?|residences?|guest-rooms)(\/|$|\?|#)/i.test(new URL(u).pathname);
      if (byText) { if (/\?/.test(u)) links.push(u); else links.unshift(u); } else if (byUrl) links.push(u);
    }
    // THE HOTEL'S OWN PAGES FIRST (M1015). On a group site the hotel lives at a path
    // (dorchestercollection.com/london/the-dorchester); its own Rooms & Suites page sits under that
    // path, while the group's "Residences" and other hotels' pages do not. Rank own-path links
    // first, and when the hotel has a path of its own, leave the group's pages for last.
    const ownPath = (() => { try { const p = new URL(root).pathname.replace(/\/+$/, "").toLowerCase(); return p && p !== "/" ? p : ""; } catch (e) { return ""; } })();
    const under = (u) => { try { return !!ownPath && new URL(u).pathname.toLowerCase().startsWith(ownPath + "/"); } catch (e) { return false; } };
    let ranked = [...new Set(links)].sort((a, b) => (under(b) ? 1 : 0) - (under(a) ? 1 : 0));
    // THE PARENT IS THE LIST (M1016): a menu that offers classic-room, superior-room, deluxe-room…
    // under /rooms-suites/ is pointing at one list page. Try the parent before its children.
    const parents = {}; for (const u of ranked) { try { const x = new URL(u); const segs = x.pathname.replace(/\/+$/, "").split("/"); if (segs.length > 2) { const p = x.origin + segs.slice(0, -1).join("/"); parents[p] = (parents[p] || 0) + 1; } } catch (e) {} }
    const lists = Object.keys(parents).filter((p) => parents[p] >= 2 && /room|suite|accommodation|stay|villa|residence/i.test(p)).sort((a, b) => parents[b] - parents[a]);
    ranked = [...lists, ...ranked.filter((u) => !lists.includes(u))];
    TRIED.push({ note: "menu candidates", ownPath: ownPath || null, candidates: ranked.slice(0, 8) });
    // M1021: the menu's own LIST page (a parent of several room pages) goes first — the menu knows;
    // guessed addresses are the fallback and stop after two misses. (Hotel Eden: /accommodations/
    // 404 twice, then the clock ran out on /rooms-suites, which was right there at the top.)
    const menuLists = ranked.filter((u) => lists.includes(u));
    for (const u of menuLists.slice(0, 2)) { const got = await attempt(u.split("#")[0], true); if (got) return got; if (Date.now() - T0 > 40000) break; }
    if (refusesFetch) {
      let misses = 0;
      for (const p of ["/accommodations/", "/rooms-suites", "/rooms-and-suites", "/rooms", "/accommodation", "/stay"]) { const before = TRIED.length; const got = await attempt(root + p, false); if (got) return got; if (TRIED.slice(before).some((x) => x.status === 404 || x.verdict === "no page")) misses++; if (misses >= 2 || browserReads >= 3 || Date.now() - T0 > 35000) break; }
    }
    for (const u of ranked.slice(0, 6)) { const got = await attempt(u.split("#")[0], true); if (got) return got; if (Date.now() - T0 > 60000) break; }
  }
  for (const p of ROOM_PATHS) {
    for (const cand of [root + p, origin + p]) { const got = await attempt(cand); if (got) return got; }
  }
  return home;   // better than nothing: the reader may still find a rooms section, or say no-rooms-found
}

// A HARD 50-SECOND ANSWER (M1014): Safari drops the request at ~60 s and shows "server stopped
// responding". Whatever is known by 50 s is sent back with the list of addresses tried.
// FINISH IN THE BACKGROUND (M1022). A big site read cold (three browser round-trips and a 700 KB
// page through the model — Four Seasons New York) takes longer than Safari will wait. At 45 s the
// reader answers "still reading" and KEEPS GOING: the function stays alive until the read is done
// (Vercel's waitUntil; the rooms function has 90 s), the result lands in the store, and the card,
// which polls every few seconds on "reading", picks it up. The client never sees a timeout.
import { waitUntil } from "@vercel/functions";
export default async function handler(req, res) {
  let sent = false; const json = res.json.bind(res); res.json = (b) => { if (sent) return res; sent = true; return json(b); };
  const timer = new Promise((r) => setTimeout(r, 45000, "timeout"));
  let outcome = "done";
  STORE_LOG.length = 0;
  const site = String((req.query || {}).site || "").slice(0, 300).trim();
  const job = work(req, res).then(() => "done").catch(async (e) => { const msg = "error:" + String(e && e.message || e).slice(0, 300); try { await noteFailure(site, msg); } catch (x) {} return msg; });
  try { outcome = await Promise.race([job, timer]); } catch (e) { outcome = "error:" + String(e && e.message || e).slice(0, 200); }
  if (outcome !== "timeout") await closeSession();
  if (!sent) {
    res.setHeader("Cache-Control", "no-store");
    if (outcome === "timeout") { try { waitUntil(job); } catch (e) {} res.status(200).json({ ok: false, reason: "reading", detail: "still reading the hotel's site — ask again in a few seconds", store: STORE_LOG.slice(-6), tried: TRIED.slice(-40) }); }
    else res.status(200).json({ ok: false, reason: "error", detail: outcome, tried: TRIED.slice(-40) });
  }
}
// THE ROOMS STORE (M1019). Vercel's cache is wiped by every deploy, so the first open of every
// hotel after a deploy paid the full 35–60 s read. The rooms now also live in Supabase
// (table hotel_rooms, 30-day freshness), written by the server with the service key and read
// before any site is touched. Env in Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Without
// them the store is simply skipped.
const STORE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const STORE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const FRESH_MS = 30 * 86400000;
async function storeRead(site) {
  if (!STORE_URL || !STORE_KEY) return null;
  try {
    const r = await fetch(`${STORE_URL}/rest/v1/hotel_rooms?site=eq.${encodeURIComponent(site)}&select=hotel,source,booking,rooms,fetched_at`, { headers: { apikey: STORE_KEY, Authorization: `Bearer ${STORE_KEY}` } });
    STORE_LOG.push({ store: "read", status: r.status, body: r.ok ? undefined : (await r.text()).slice(0, 200) });
    if (!r.ok) return null;
    const rows = await r.json(); const row = rows && rows[0];
    if (!row || !Array.isArray(row.rooms) || !row.rooms.length) return null;
    if (row.source === "reading") return (Date.now() - Date.parse(row.fetched_at) < 120000) ? { reading: true } : null;   // M1023: a read in progress elsewhere
    if (row.source === "failed") return { failed: row.rooms && row.rooms[0] ? row.rooms[0] : { failed: "unknown" }, at: row.fetched_at };   // M1024: what went wrong last time
    if (Date.now() - Date.parse(row.fetched_at) > FRESH_MS) return null;
    return row;
  } catch (e) { return null; }
}
const READING = {};   // site → started-at (this instance); the store carries a marker for other instances
const STORE_LOG = [];
async function markReading(site, hotel) {
  READING[site] = Date.now();
  if (!STORE_URL || !STORE_KEY) { STORE_LOG.push({ store: "off", url: !!STORE_URL, key: !!STORE_KEY }); return; }
  try { const r = await fetch(`${STORE_URL}/rest/v1/hotel_rooms?on_conflict=site`, { method: "POST", headers: { apikey: STORE_KEY, Authorization: `Bearer ${STORE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ site, hotel, source: "reading", booking: null, rooms: [{ reading: true }], fetched_at: new Date().toISOString() }) }); STORE_LOG.push({ store: "mark", status: r.status, body: r.ok ? undefined : (await r.text()).slice(0, 200) }); } catch (e) { STORE_LOG.push({ store: "mark", error: String(e && e.message || e).slice(0, 120) }); }
}
async function noteFailure(site, msg) {
  if (!STORE_URL || !STORE_KEY || !site) return;
  try { await fetch(`${STORE_URL}/rest/v1/hotel_rooms?on_conflict=site`, { method: "POST", headers: { apikey: STORE_KEY, Authorization: `Bearer ${STORE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ site, hotel: "", source: "failed", booking: null, rooms: [{ failed: msg, log: STORE_LOG.slice(-6), tried: TRIED.slice(-12) }], fetched_at: new Date().toISOString() }) }); } catch (e) {}
}
async function clearReading(site) {
  delete READING[site];
  if (!STORE_URL || !STORE_KEY) return;
  try { await fetch(`${STORE_URL}/rest/v1/hotel_rooms?site=eq.${encodeURIComponent(site)}&source=in.(reading,failed)`, { method: "DELETE", headers: { apikey: STORE_KEY, Authorization: `Bearer ${STORE_KEY}` } }); } catch (e) {}
}
async function storeWrite(site, hotel, source, booking, rooms) {
  if (!STORE_URL || !STORE_KEY) return false;
  try {
    const r = await fetch(`${STORE_URL}/rest/v1/hotel_rooms?on_conflict=site`, { method: "POST", headers: { apikey: STORE_KEY, Authorization: `Bearer ${STORE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ site, hotel, source, booking, rooms, fetched_at: new Date().toISOString() }) });
    STORE_LOG.push({ store: "write", status: r.status, body: r.ok ? undefined : (await r.text()).slice(0, 200) });
    return r.ok;
  } catch (e) { STORE_LOG.push({ store: "write", error: String(e && e.message || e).slice(0, 120) }); return false; }
}
async function work(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const key = process.env.ANTHROPIC_API_KEY;
  res.setHeader("Cache-Control", "no-store");
  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  TRIED.length = 0;
  const debug = String(req.query.debug || "") === "1";
  const hotel = String(req.query.hotel || "").slice(0, 120).trim();
  const site = String(req.query.site || "").slice(0, 300).trim();
  if (!hotel || !site || !/^[a-z0-9.-]+\.[a-z]{2,}/i.test(site.replace(/^https?:\/\//, ""))) return res.status(200).json({ ok: false, reason: "bad-request" });

  // The store first: no site is touched for a hotel read within the month.
  if (String(req.query.fresh || "") !== "1") {
    const kept = await storeRead(site);
    if (kept && kept.failed) { await clearReading(site); if (debug) { res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: false, reason: "last-read-failed", at: kept.at, failed: kept.failed, note: "the note is cleared; this request is reading afresh — run again" }); } }
    if (kept && kept.reading) { res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: false, reason: "reading", detail: "still reading the hotel's site — ask again in a few seconds", via: "store" }); }
    if (kept) { res.setHeader("Cache-Control", "public, s-maxage=2592000, stale-while-revalidate=604800"); return res.status(200).json({ ok: true, hotel: kept.hotel || hotel, source: kept.source, booking: kept.booking || null, fetched: kept.fetched_at, rooms: kept.rooms, via: "store" }); }
  }
  await markReading(site, hotel);
  let page = null;
  try { page = await findRoomsPage(site); } catch (e) { page = null; }
  // A HOLLOW PAGE IS READ AGAIN IN THE BROWSER (M997). Rosewood's accommodation page arrives as a
  // shell — menu and a promo — and draws its rooms with JavaScript afterwards; a plain fetch
  // never sees them. If the page we hold shows few room signals, open it in the browser.
  const roomSignals = (html) => { const t = String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "); return (t.match(/\b\d{2,4}\s?(?:m²|m2|sq\.?\s?m|sq\.?\s?ft)/gi) || []).length + (t.match(/\b(king|queen|twin|double)\s+bed/gi) || []).length; };
  if (page && !/^browser/.test(page.via || "") && roomSignals(page.html) < 2) {
    TRIED.push({ url: page.url, note: "hollow — reading again in the browser", signals: roomSignals(page.html) });
    try { const again = await getWithBrowser(page.url); if (again && roomSignals(again.html) > roomSignals(page.html)) page = again; } catch (e) {}
  }
  if (!page) { await clearReading(site); res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: false, reason: "unreachable", hotel, site, node: process.version, hostedBrowser: !!(process.env.BROWSERLESS_TOKEN || "").trim(), tokenLength: (process.env.BROWSERLESS_TOKEN || "").trim().length, tried: TRIED }); }
  await closeSession();   // M1025: the browser is not needed past this point
  // The hotel's own "Check Rates" link, from the page we already hold, so the rates reader need
  // not open the site again to find it (M985). Prefer the link that names the hotel.
  const booking = (() => {
    const ENG = /reservations\.fourseasons\.com|be\.synxis\.com|reservations\.travelclick\.com|ihotelier|secure-hotel-booking|reservation\.|reservations\.|\/reservations\/|\/booking\/|\/book\/|hilton\.com\/[a-z]{2}\/book|ctyhocn=|hyatt\.com\/shop\/rooms|all\.accor\.com\/(?:ssr|hotel|lien_externe)|marriott\.com\/reservation|propertyCode=|[?&]chain=\d+/i;   // own /reservations/ (M1002); Hilton, Hyatt, Accor, Marriott (M1011); SynXis by signature (M1018)
    const CODED = /(?:locationId|hotelCode|hotel|hotelId|propertyId|productId|chain|Hotel|Chain)=/;
    const urls = []; const re = /href\s*=\s*["']([^"']+)["']/gi; let m;
    while ((m = re.exec(page.html))) { try { urls.push(new URL(m[1].replace(/&amp;/g, "&"), page.url).toString()); } catch (e) {} }
    const eng = urls.filter((u) => ENG.test(u) && !/\/(?:profile|signin|sign-in|login|findreservation|find-reservation|itinerary|modify|cancel)/i.test(u));
    return eng.find((u) => CODED.test(u)) || eng[0] || null;
  })();
  // THE ROOMS ARE A FRACTION OF THE PAGE (M1023). Four Seasons New York's accommodations page is
  // 685 KB; the room list is a few thousand words of it. Keep the stretch of text where room
  // signals (sizes, beds, "suite", "room") are densest, up to 45,000 characters, so the model
  // answers in time and the first read fits inside one call.
  const whole = distill(page.html, page.url);
  const text = (() => {
    if (whole.length <= 45000) return whole;
    const W = 3000; const n = Math.ceil(whole.length / W); const score = [];
    for (let i = 0; i < n; i++) { const seg = whole.slice(i * W, (i + 1) * W); score.push((seg.match(/\b\d{2,4}\s?(?:m²|m2|sq\.?\s?m|sq\.?\s?ft)/gi) || []).length * 3 + (seg.match(/\b(king|queen|twin|double)\s+bed/gi) || []).length * 2 + (seg.match(/\b(suite|room|penthouse|villa)\b/gi) || []).length + (seg.match(/\[IMG#/g) || []).length); }
    const span = Math.floor(45000 / W); let best = 0, bestSum = -1;
    for (let i = 0; i + span <= n; i++) { const s = score.slice(i, i + span).reduce((a, b) => a + b, 0); if (s > bestSum) { bestSum = s; best = i; } }
    return whole.slice(best * W, best * W + 45000);
  })();
  if (text.length < 300) { await clearReading(site); return res.status(200).json({ ok: false, reason: "empty", hotel, source: page.url, tried: debug ? TRIED : undefined }); }

  const prompt = `Below is the text of a hotel's own website page, with its images shown as [IMG#n | alt] (n is the image number) and links as [LINK url]. The hotel is "${hotel}". Extract the hotel's ROOM AND SUITE CATEGORIES exactly as the hotel names them.

Return ONLY a JSON object: { "rooms": [ { "name", "category", "size", "beds", "occupancy", "view", "description", "images", "url" } ] }
- name: the room/suite/villa name exactly as written on the page
- category: the section heading it sits under on the page (e.g. "Guest Rooms", "Suites", "Specialty Suites"), or null
- size: the size text as written (e.g. "45–50 m2 (484–538 sq. ft.)"), or null
- beds: bed configuration as written, or null
- occupancy: as written, or null
- view: the view or defining feature as written (terrace, balcony, garden, sea view), or null
- description: the hotel's own one- or two-sentence description of that room if present, else null — never write your own
- images: up to 2 image NUMBERS (plain integers) that belong to this room (the [IMG#n] entries nearest its name, or whose alt names it); [] if none
- url: the room's own detail page [LINK] if there is one, else null
Rules: list every category once, in page order; do not invent, merge or rename rooms; skip offers, dining, spa and navigation; if the page has no rooms, return { "rooms": [] }. No prose outside the JSON.

PAGE TEXT
${text}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) { const detail = await r.text(); await noteFailure(site, `anthropic ${r.status}: ${detail.slice(0, 200)}`); return res.status(200).json({ ok: false, reason: "anthropic-error", status: r.status, detail: detail.slice(0, 200) }); }
    const data = await r.json();
    const out = (data.content || []).map((b) => b.text || "").join("").trim();
    const jm = /\{[\s\S]*\}/.exec(out);
    let parsed; try { parsed = jm ? JSON.parse(jm[0]) : null; } catch (e) { parsed = null; }
    if (!parsed || !Array.isArray(parsed.rooms)) {
      // A long answer can be cut off mid-list: keep every room object that is complete.
      const objs = []; const re = /\{\s*"name"\s*:[\s\S]*?\}(?=\s*(?:,\s*\{|\s*\]))/g; let m;
      while ((m = re.exec(out))) { try { objs.push(JSON.parse(m[0])); } catch (e) {} }
      parsed = objs.length ? { rooms: objs, truncated: true } : null;
    }
    if (!parsed || !Array.isArray(parsed.rooms)) return res.status(200).json({ ok: false, reason: "unreadable", hotel, source: page.url, textLength: text.length, tried: debug ? TRIED : undefined, answer: debug ? out.slice(0, 1500) : undefined, sample: debug ? text.slice(0, 2000) : undefined });
    const S = (v, n = 300) => (v == null || v === "" ? null : String(v).trim().slice(0, n));
    const rooms = parsed.rooms.filter((x) => x && x.name).slice(0, 40).map((x) => ({
      name: S(x.name, 120), category: S(x.category, 80), size: S(x.size, 80), beds: S(x.beds, 120), occupancy: S(x.occupancy, 120), view: S(x.view, 120), description: S(x.description, 600),
      images: (Array.isArray(x.images) ? x.images : []).map((v) => { const n = parseInt(String(v).replace(/[^0-9]/g, ""), 10); return n >= 1 && n <= IMAGES.length ? IMAGES[n - 1] : (typeof v === "string" && /^https?:\/\//.test(v) ? v : null); }).filter(Boolean).slice(0, 2),
      url: typeof x.url === "string" && /^https?:\/\//.test(x.url) ? x.url : null,
    }));
    res.setHeader("Cache-Control", "public, s-maxage=2592000, stale-while-revalidate=604800");
    if (!rooms.length) { await clearReading(site); res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: false, reason: "no-rooms-found", hotel, source: page.url, tried: debug ? TRIED : undefined, sample: debug ? text.slice(0, 2000) : undefined }); }
    const stored = await storeWrite(site, hotel, page.url, booking, rooms);
    return res.status(200).json({ ok: true, hotel, source: page.url, booking, stored, fetched: new Date().toISOString(), rooms, truncated: parsed.truncated ? true : undefined, tried: debug ? TRIED : undefined });
  } catch (e) {
    await noteFailure(site, "model:" + String(e && e.message || e).slice(0, 300));
    return res.status(200).json({ ok: false, reason: "fetch", detail: String(e && e.message || e).slice(0, 200) });
  }
}
