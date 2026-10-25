// api/hotel-look.js — the hotel's own introduction: its film, its photographs, what it has (M977; M981: playable films only, large stills, names only, facilities; M983: mp4 first for Safari, hidden gallery links, labels must be the photo's own — 25 Oct 2026).
//
// Before the rooms, the place (Tricia, 25 Oct 2026): the film the hotel runs on its own home page,
// and the photographs it publishes of the lobby, pool, spa, dining and grounds. This function opens
// the hotel's home page and gallery page in the hosted browser, lifts the video address and the
// large photographs the hotel itself serves, and has the model label and choose the best dozen.
// One method for every hotel; nothing is stock, nothing is invented. Where a hotel runs no film,
// `video` is null and the card shows the gallery alone; where it publishes no gallery, `gallery`
// is empty and the card looks as it did.
//
// GET /api/hotel-look?hotel=<name>&site=<hotel website>
//   &debug=1 → also returns every address tried and the raw candidates
// Returns: { ok:true, hotel, source, fetched,
//            video: { src, kind:"mp4"|"hls"|"webm"|"youtube"|"vimeo", poster } | null,   — only a film that plays from OUTSIDE the hotel's site (M981)
//            gallery: [ { src, label } ],   — large stills; label only a proper name the hotel uses (a restaurant, a bar, a named spa), else ""
//            facilities: [ { name, kind } ] }   — what the hotel says it has: restaurants and bars by name, spa, pool, fitness
// Cached at the edge for 30 days. Needs ANTHROPIC_API_KEY and BROWSERLESS_TOKEN (both set).
//
// How the video is found, in order: a <video> element's sources on the page; any video the page
// streamed while loading (mp4 / HLS .m3u8 / webm — caught on the wire, so players that hide their
// address still give it up); a YouTube or Vimeo embed. Safari plays HLS natively, so an .m3u8
// address works on an iPad without any player of ours.

import chromiumPkg from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const MODEL = "claude-haiku-4-5-20251001";
const UA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const GALLERY_PATHS = ["/photos-and-videos", "/photos-videos", "/gallery", "/photo-gallery", "/photos", "/gallery/photos", "/media-gallery", "/en/gallery", "/the-hotel/gallery", "/hotel/gallery", "/images"];

async function openBrowser() {
  const token = (process.env.BROWSERLESS_TOKEN || "").trim();
  if (token) {
    const region = process.env.BROWSERLESS_REGION || "production-sfo";
    // No ad blocker (see hotel-rates.js M988): a blocked tag manager leaves some sites half-drawn.
    const ws = `wss://${region}.browserless.io?token=${encodeURIComponent(token)}&stealth=true&timeout=80000`;
    const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: { width: 1280, height: 1800 } });
    return { browser, via: "browserless" };
  }
  chromiumPkg.setGraphicsMode = false;
  const browser = await puppeteer.launch({ args: chromiumPkg.args, defaultViewport: { width: 1280, height: 1800 }, executablePath: await chromiumPkg.executablePath(), headless: chromiumPkg.headless });
  return { browser, via: "bundled" };
}

const abs = (base, u) => { try { return new URL(u, base).toString(); } catch (e) { return null; } };
const isMedia = (u) => /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(u);
const kindOf = (u) => /\.m3u8(\?|$)/i.test(u) ? "hls" : /\.webm(\?|$)/i.test(u) ? "webm" : /youtube\.com|youtu\.be/i.test(u) ? "youtube" : /vimeo\.com/i.test(u) ? "vimeo" : "mp4";
const NOISE = /logo|icon|sprite|badge|award|flag|arrow|pixel|tracking|\.svg(\?|$)|blank\.|spacer|avatar|map/i;

// Everything a page shows: its videos, its embeds, and its photographs with the words beside them.
const harvest = () => {
  const out = { videos: [], embeds: [], images: [] };
  const seen = new Set();
  const near = (el) => {
    // the caption or heading nearest a photograph — the hotel's own words for it
    let n = el; for (let i = 0; i < 4 && n; i++) {
      const cap = n.querySelector && n.querySelector("figcaption, h1, h2, h3, h4, .caption, [class*=caption], [class*=title]");
      if (cap && cap.innerText && cap.innerText.trim()) return cap.innerText.trim().slice(0, 80);
      n = n.parentElement;
    }
    return "";
  };
  document.querySelectorAll("video").forEach((v) => {
    const srcs = [v.currentSrc, v.src, ...Array.from(v.querySelectorAll("source")).map((s) => s.src || s.getAttribute("src") || "")].filter(Boolean);
    srcs.forEach((s) => { if (!seen.has(s)) { seen.add(s); out.videos.push({ src: s, poster: v.poster || "" }); } });
  });
  document.querySelectorAll("iframe").forEach((f) => { const s = f.src || ""; if (/youtube\.com\/embed|youtube-nocookie\.com\/embed|player\.vimeo\.com\/video/i.test(s) && !seen.has(s)) { seen.add(s); out.embeds.push(s); } });
  document.querySelectorAll("img").forEach((im) => {
    let best = im.currentSrc || im.src || im.getAttribute("data-src") || "";
    let w = im.naturalWidth || 0, h = im.naturalHeight || 0;
    const ss = im.getAttribute("srcset") || im.getAttribute("data-srcset") || "";
    if (ss) {   // the largest candidate in the srcset
      let top = null; ss.split(/,\s*(?=\S+\s+\d+w)/).forEach((c) => { const m = /^(\S+)\s+(\d+)w/.exec(c.trim()); if (m && (!top || +m[2] > top.w)) top = { u: m[1], w: +m[2] }; });
      if (top && top.w > w) { best = top.u; w = top.w; }
    }
    if (!best || /^data:/.test(best)) return;
    const r = im.getBoundingClientRect();
    if (seen.has(best)) return; seen.add(best);
    out.images.push({ src: best, alt: (im.alt || "").trim().slice(0, 80), w: w || Math.round(r.width), h: h || Math.round(r.height), near: near(im) });
  });
  // photographs set as backgrounds (hero banners often are)
  document.querySelectorAll("[style*='background-image']").forEach((el) => {
    const m = /url\(["']?([^"')]+)["']?\)/.exec(el.getAttribute("style") || ""); if (!m) return;
    const r = el.getBoundingClientRect(); if (r.width < 600 || seen.has(m[1])) return; seen.add(m[1]);
    out.images.push({ src: m[1], alt: "", w: Math.round(r.width), h: Math.round(r.height), near: near(el) });
  });
  return out;
};

async function readPage(page, url, wire) {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }); } catch (e) {}
  // scroll so lazy photographs load, then back to the top so the hero video starts
  try { await page.evaluate(async () => { const h = document.body.scrollHeight; for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); }); } catch (e) {}
  await new Promise((r) => setTimeout(r, 1200));
  const got = await page.evaluate(harvest);
  try { got.text = await page.evaluate(() => (document.body ? document.body.innerText : "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim()); } catch (e) { got.text = ""; }
  const base = page.url();
  got.videos = got.videos.map((v) => ({ src: abs(base, v.src), poster: v.poster ? abs(base, v.poster) : "" })).filter((v) => v.src);
  got.images = got.images.map((im) => ({ ...im, src: abs(base, im.src) })).filter((im) => im.src && /^https?:/.test(im.src));
  got.wire = wire.slice();
  got.status = resp ? resp.status() : null;
  got.url = base;
  return got;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  const hotel = String(req.query.hotel || "").slice(0, 120).trim();
  const site = String(req.query.site || "").slice(0, 300).trim();
  const debug = String(req.query.debug || "") === "1";
  if (!hotel || !site || !/^[a-z0-9.-]+\.[a-z]{2,}/i.test(site.replace(/^https?:\/\//, ""))) return res.status(200).json({ ok: false, reason: "bad-request" });
  const base = /^https?:\/\//.test(site) ? site : "https://" + site;
  const root = base.replace(/\/+$/, "");
  const origin = new URL(base).origin;
  const T0 = Date.now(); const log = [];

  let browser = null, home = null, gallery = null;
  const wire = [];
  try {
    const opened = await openBrowser(); browser = opened.browser;
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    // videos caught on the wire — the surest way, whatever player a hotel uses
    page.on("response", (r) => { try { const u = r.url(); const ct = (r.headers()["content-type"] || "").toLowerCase(); if ((/^video\//.test(ct) || /mpegurl/.test(ct) || isMedia(u)) && !wire.includes(u) && wire.length < 20) wire.push(u); } catch (e) {} });
    log.push({ step: "browser", via: opened.via, ms: Date.now() - T0 });
    home = await readPage(page, root, wire);
    log.push({ step: "home", url: home.url, status: home.status, videos: home.videos.length, wire: home.wire.length, images: home.images.length, ms: Date.now() - T0 });
    // the gallery page: a link on the home page that says so, else the usual addresses
    let galleryUrl = null;
    try {
      const links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => ({ href: a.href, text: (a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60) })));
      const same = (l) => { try { return new URL(l.href).origin === origin; } catch (e) { return false; } };
      const hit = links.find((l) => /\/(gallery|photos|photo-gallery|photos-and-videos|photos-videos|media-gallery)(\/|$|\?)/i.test(l.href) && same(l)) || links.find((l) => /^(photos?|gallery|photo gallery|photos\s*&\s*videos|photos and videos)$/i.test(l.text) && same(l));
      if (hit) galleryUrl = hit.href;
    } catch (e) {}
    if (!galleryUrl) {
      for (const p of GALLERY_PATHS) {
        const cand = root + p;
        try { const r = await fetch(cand, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" }); if (r.ok) { galleryUrl = cand; break; } } catch (e) {}
        if (Date.now() - T0 > 30000) break;
      }
    }
    if (galleryUrl && galleryUrl !== home.url && Date.now() - T0 < 45000) {
      try { gallery = await readPage(page, galleryUrl, wire); log.push({ step: "gallery", url: gallery.url, images: gallery.images.length, ms: Date.now() - T0 }); } catch (e) { log.push({ step: "gallery", url: galleryUrl, error: String(e && e.message || e).slice(0, 160) }); }
    }
    await browser.close(); browser = null;
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (x) {} }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: false, reason: "browser", detail: String(e && e.message || e).slice(0, 400), log });
  }

  // 1. The film: a <video> on the home page first, then anything streamed, then an embed — and only
  //    one that answers from outside the hotel's site. M977 offered a file the hotel locks to its own
  //    pages and the card showed a black square (Tricia, 25 Oct 2026). A film that will not play is
  //    not offered; the stills take its place.
  // Returns the file's real type when it answers from outside, else null. Four Seasons serves its
  // film as WebM/AV1 first — which Safari on an iPad cannot play (the black square, M981) — and
  // as plain MP4 too; the page is given every verified version, MP4 first, and the browser
  // takes the one it can play.
  const plays = async (u) => {
    try {
      const r = await fetch(u, { method: "GET", headers: { "User-Agent": UA, "Range": "bytes=0-1023", "Origin": "https://voyageoneworld.com" }, redirect: "follow" });
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      log.push({ step: "video-check", url: u.slice(0, 140), status: r.status, type: ct.slice(0, 40) });
      return (r.status === 200 || r.status === 206) && (/^video\//.test(ct) || /mpegurl|octet-stream/.test(ct)) ? (ct.split(";")[0] || "video/mp4") : null;
    } catch (e) { log.push({ step: "video-check", url: u.slice(0, 140), error: String(e && e.message || e).slice(0, 80) }); return null; }
  };
  let video = null;
  const vids = [...home.videos.map((v) => ({ src: v.src, poster: v.poster })), ...wire.map((u) => ({ src: u, poster: "" }))].filter((v) => v.src && !/blob:/.test(v.src) && !/\.ts(\?|$)|\/seg|chunk|fragment/i.test(v.src));
  const transcoded = (u) => /vid-opt|~av1|~vp9|\.webm/i.test(u);   // a site's re-encoded copies, after its plain file
  const order = [...vids.filter((v) => /\.mp4(\?|$)/i.test(v.src) && !transcoded(v.src)), ...vids.filter((v) => /\.m3u8(\?|$)/i.test(v.src)), ...vids.filter((v) => !(/\.mp4(\?|$)/i.test(v.src) && !transcoded(v.src)) && !/\.m3u8(\?|$)/i.test(v.src))];
  const sources = [];
  for (const v of order.slice(0, 5)) { if (Date.now() - T0 > 60000) break; const ty = await plays(v.src); if (ty) sources.push({ src: v.src, type: ty, poster: v.poster || "" }); }
  sources.sort((a, b) => (/mp4|mpegurl/.test(a.type) ? 0 : 1) - (/mp4|mpegurl/.test(b.type) ? 0 : 1));
  if (sources.length) video = { src: sources[0].src, kind: kindOf(sources[0].src), poster: sources.find((x) => x.poster) ? sources.find((x) => x.poster).poster : (home.videos[0] && home.videos[0].poster) || null, sources: sources.map((x) => ({ src: x.src, type: x.type })) };
  if (!video && home.embeds.length) video = { src: home.embeds[0], kind: kindOf(home.embeds[0]), poster: null };

  // 2. The photographs: large, the hotel's own, labelled in its words. The model chooses and
  //    labels up to twelve from the candidates; it may not add, rename or invent any.
  const cands = [...(gallery ? gallery.images : []), ...home.images]
    .filter((im) => !NOISE.test(im.src) && !NOISE.test(im.alt) && (im.w >= 1000 || im.h >= 700))   // large enough to fill the card
    .filter((im, i, a) => a.findIndex((x) => x.src === im.src) === i)
    .slice(0, 80);
  let picked = [], facilities = [];
  if (cands.length) {
    const list = cands.map((im, i) => `[${i + 1}] ${im.w}x${im.h} | alt: ${im.alt || "-"} | near: ${im.near || "-"} | ${im.src}`).join("\n");
    const words = (home.text || "").slice(0, 12000);
    const prompt = `Below are (A) photographs found on the website of "${hotel}" and (B) the text of its home page.

TASK 1 — choose up to 12 photographs that introduce the hotel as the hotel itself would: the building and its setting, the lobby, the bar, the restaurants, the pool, the spa, gardens, views, signature spaces — in a good order, the most striking first. Skip guest rooms and suites (shown elsewhere), portraits, logos, maps, menus, near-duplicates and anything small or cropped oddly.
"label": ONLY a proper name the hotel uses for that place — a restaurant or bar by name, a spa or club with its own name (e.g. "Dani Brasserie", "Isa", "El Patio"). Otherwise "" — never a description such as "Hotel exterior", "The lobby", "Pool area", "Spa"; the photograph speaks for itself.

TASK 2 — list what the hotel says it has, from the page text only: each restaurant and bar BY NAME, the spa (by name if it has one, else "Spa"), "Pool" or "Rooftop pool" as the text puts it, "Fitness" if a gym is mentioned, and any named club or notable space. Nothing the text does not state.

Return ONLY JSON: { "pick": [ { "n": <number>, "label": "<proper name or empty>" } ], "facilities": [ { "name": "<as the hotel writes it>", "kind": "restaurant"|"bar"|"spa"|"pool"|"fitness"|"other" } ] }

(A) PHOTOGRAPHS
${list}

(B) HOME PAGE TEXT
${words}`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: prompt }] }) });
      if (r.ok) {
        const data = await r.json(); const out = (data.content || []).map((b) => b.text || "").join("");
        const jm = /\{[\s\S]*\}/.exec(out); const parsed = jm ? JSON.parse(jm[0]) : null;
        const BANNED = /^(hotel|the hotel|exterior|interior|lobby|the lobby|pool|pool area|spa|gym|fitness|garden|view|views|terrace|restaurant|bar|dining|room|suite|building|facade|entrance|night|day)(\s|'s|$)/i;
        if (parsed && Array.isArray(parsed.pick)) picked = parsed.pick.map((p) => { const im = cands[Number(p.n) - 1]; if (!im) return null; const lab = String(p.label || "").trim().slice(0, 60); const own = lab && ((im.alt || "") + " " + (im.near || "")).toLowerCase().includes(lab.toLowerCase()); return { src: im.src, label: own && !BANNED.test(lab) && lab.split(/\s+/).length <= 4 ? lab : "" }; }).filter(Boolean).slice(0, 12);
        if (parsed && Array.isArray(parsed.facilities)) { const seen = new Set(); facilities = parsed.facilities.filter((f) => f && f.name).map((f) => ({ name: String(f.name).trim().slice(0, 60), kind: /^(restaurant|bar|spa|pool|fitness|other)$/.test(f.kind) ? f.kind : "other" })).filter((f) => { const k = f.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 14); }
      }
    } catch (e) { picked = []; }
    if (!picked.length) picked = cands.slice(0, 8).map((im) => ({ src: im.src, label: "" }));   // the model is a curator, not a gate
  }
  if (video && video.poster && !picked.some((p) => p.src === video.poster)) { /* the poster stays with the video */ }

  const ok = !!(video || picked.length);
  res.setHeader("Cache-Control", ok ? "public, s-maxage=2592000, stale-while-revalidate=604800" : "no-store");
  return res.status(200).json({ ok, hotel, source: home.url, fetched: new Date().toISOString(), video, gallery: picked, facilities, reason: ok ? undefined : "nothing-found",
    log: debug ? log : undefined, candidates: debug ? { videos: home.videos, wire, embeds: home.embeds, images: cands.slice(0, 40) } : undefined });
}
