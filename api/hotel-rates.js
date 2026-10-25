// api/hotel-rates.js — live room rates from the hotel's own booking engine (build M973; puppeteer pairing M976; hosted browser M977; token diagnostics M978; longer answers + salvage M979; link via browser + candidate addresses M981; coded link preferred M982; cookie banner + wait for prices M983; one browser, faster M984; link from rooms reader M985; stages + timings M986, 25 Oct 2026).
//
// THE BRIDGE UNTIL THE HOST'S SABRE LINE. A client will not choose a room without a price beside
// it (Tricia, 25 Oct 2026). Real per-room prices for a date live in the hotel's reservation
// system; until we reach it through Sabre, this function reaches it the way a guest does: a
// browser on our server opens the hotel's own rate page for the client's dates, and the same
// reader that extracts the rooms turns the page into data. Prices are the hotel's own, as shown
// at that moment, and the reservation is still placed by Voyage One.
//
// GET /api/hotel-rates?hotel=<name>&site=<hotel website>&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&pax=2
//   &debug=1  → also returns the booking URL used and the first 3,000 characters the browser saw
// Returns: { ok:true, hotel, checkIn, checkOut, source, rates: { "<room name>": [ { plan, price,
//            currency, perNight, cancel, benefits } ] } }   — or { ok:false, reason }
//
// Honest limits, by design:
//   • Engines differ. The date parameters are known for Four Seasons, SynXis and TravelClick
//     engines; a hotel on another engine answers { ok:false, reason:"unsupported-engine" } and the
//     card says "Rate confirmed by the hotel". Add an engine = add one line to ENGINES.
//   • A redesign at a brand breaks its line until the pattern is updated — the card then shows no
//     price for that brand rather than a wrong one. Nothing is ever estimated.
//   • Needs a browser on the server: package.json adds puppeteer-core + @sparticuz/chromium and
//     vercel.json gives this function 60 seconds and 1.5 GB. Needs ANTHROPIC_API_KEY (already set).
//   • Cached 5 minutes per hotel/dates/party; never searched in the background.

import chromiumPkg from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const MODEL = "claude-haiku-4-5-20251001";
// WHERE THE BROWSER RUNS (M977, 25 Oct 2026). Vercel's function image lacks a system library the
// bundled Chromium needs ("libnss3.so"), so the browser is hosted: with BROWSERLESS_TOKEN set in
// Vercel, the readers connect to Browserless (plumbing, like Vercel or Supabase — nothing a
// client sees); without it they still try the bundled browser, which works on hosts that have
// the library. ?debug=1 reports which one answered.
async function openBrowser() {
  const token = (process.env.BROWSERLESS_TOKEN || "").trim();
  if (token) {
    const region = process.env.BROWSERLESS_REGION || "production-sfo";
    const ws = `wss://${region}.browserless.io?token=${encodeURIComponent(token)}&stealth=true&blockAds=true&timeout=90000`;
    const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: { width: 1180, height: 1600 } });
    return { browser, via: "browserless" };
  }
  chromiumPkg.setGraphicsMode = false;
  const browser = await puppeteer.launch({ args: chromiumPkg.args, defaultViewport: { width: 1180, height: 1600 }, executablePath: await chromiumPkg.executablePath(), headless: chromiumPkg.headless });
  return { browser, via: "bundled" };
}
const UA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// Which engine a booking link belongs to, and how that engine takes dates and guests.
const mdy = (iso) => { const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}`; };
const ENGINES = [
  { name: "fourseasons", test: /reservations\.fourseasons\.com/i, build: (u, ci, co, pax) => {
      // The hotel's Check Rates link carries its code (…locationId=MAD166 or hotelCode=MAD166).
      // Two address forms are tried in turn; the one that shows prices wins (M981).
      const code = (/(?:locationId|hotelCode)=([A-Z0-9]+)/i.exec(u) || [])[1];
      if (!code) return null;
      const x = new URL(u); x.searchParams.set("checkIn", ci); x.searchParams.set("checkOut", co); x.searchParams.set("adults", String(pax)); x.searchParams.set("children", "0"); x.searchParams.set("rooms", "1");
      return [`https://reservations.fourseasons.com/?hotelCode=${code}&checkIn=${ci}&checkOut=${co}&adults=${pax}&children=0&rooms=1`, x.toString()];
    } },
  { name: "synxis", test: /be\.synxis\.com/i, build: (u, ci, co, pax) => {
      const x = new URL(u); x.searchParams.set("arrive", mdy(ci)); x.searchParams.set("depart", mdy(co)); x.searchParams.set("adult", String(pax)); x.searchParams.set("child", "0"); x.searchParams.set("rooms", "1"); return x.toString();
    } },
  { name: "travelclick", test: /reservations\.travelclick\.com|ihotelier/i, build: (u, ci, co, pax) => {
      const x = new URL(u); x.searchParams.set("datein", mdy(ci)); x.searchParams.set("dateout", mdy(co)); x.searchParams.set("adults", String(pax)); x.searchParams.set("children", "0"); x.searchParams.set("rooms", "1"); return x.toString();
    } },
];

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
  if (!r.ok) return null;
  return { url: r.url, html: await r.text() };
}
// The hotel's own "Check Rates" / "Book" link, found on its site. One method for every hotel.
const LOG = [];
// Of the engine links on a page, the one that names the hotel wins (a "Check Rates" link carries a
// hotel code; "Sign in" / "Find a reservation" links on the same engine do not) — M982.
const CODED = /(?:locationId|hotelCode|hotel|hotelId|propertyId|productId|chain|Hotel|Chain)=/;
function bestLink(urls) {
  const eng = urls.filter((u) => ENGINES.some((e) => e.test.test(u)) && !/\/(?:profile|signin|sign-in|login|findreservation|find-reservation|itinerary)/i.test(u));
  return eng.find((u) => CODED.test(u)) || eng[0] || null;
}
function linkIn(html, baseUrl) {
  const re = /href\s*=\s*["']([^"']+)["']/gi; let m; const urls = [];
  while ((m = re.exec(html))) { try { urls.push(new URL(m[1].replace(/&amp;/g, "&"), baseUrl).toString()); } catch (e) {} }
  return bestLink(urls);
}
const LINK_CACHE = {};   // hotel site → booking link, for the life of the function instance
async function linkFromRooms(req, hotel, site) {
  // The rooms reader already holds the hotel's page and is cached for a month: its answer carries
  // the booking link, so this costs milliseconds instead of a browser session (M985).
  try {
    const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const r = await fetch(`${proto}://${host}/api/rooms?hotel=${encodeURIComponent(hotel)}&site=${encodeURIComponent(site)}&v=2`);
    const j = r.ok ? await r.json() : null;
    const u = j && j.ok && j.booking ? String(j.booking) : null;
    LOG.push({ step: "find-link", via: "rooms-api", ok: !!u, link: u || undefined });
    return u && ENGINES.some((e) => e.test.test(u)) ? u : null;
  } catch (e) { LOG.push({ step: "find-link", via: "rooms-api", error: String(e && e.message || e).slice(0, 120) }); return null; }
}
async function findBookingLink(site, page, via) {
  if (LINK_CACHE[site]) { LOG.push({ step: "find-link", cached: LINK_CACHE[site] }); return LINK_CACHE[site]; }
  const base = /^https?:\/\//.test(site) ? site : "https://" + site;
  const pages = [base, base.replace(/\/+$/, "") + "/accommodations"];
  // One plain request (fast); a hotel that refuses it gets the browser (M981/M984).
  let got = null; try { got = await fetchText(base); } catch (e) { got = null; }
  LOG.push({ step: "find-link", url: base, via: "fetch", ok: !!got });
  if (got) { const u = linkIn(got.html, got.url); if (u) { LINK_CACHE[site] = u; return u; } }
  for (const p of pages) {
    try {
      await page.goto(p, { waitUntil: "domcontentloaded", timeout: 20000 });
      try { await page.waitForNetworkIdle({ idleTime: 600, timeout: 6000 }); } catch (e) {}
      const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => a.href));
      LOG.push({ step: "find-link", url: p, via: "browser:" + via, links: hrefs.length });
      const u = bestLink(hrefs);
      if (u) { LINK_CACHE[site] = u; return u; }
    } catch (e) { LOG.push({ step: "find-link", url: p, via: "browser", error: String(e && e.message || e).slice(0, 200) }); }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const key = process.env.ANTHROPIC_API_KEY;
  res.setHeader("Cache-Control", "no-store");
  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  const q = req.query || {};
  const hotel = String(q.hotel || "").slice(0, 120).trim();
  const site = String(q.site || "").slice(0, 300).trim();
  const checkIn = String(q.checkIn || ""), checkOut = String(q.checkOut || "");
  const pax = Math.min(6, Math.max(1, parseInt(q.pax, 10) || 2));
  const debug = String(q.debug || "") === "1";
  const stage = String(q.stage || "");   // "link" | "page" | "" (full) — M986 diagnostics
  const T0 = Date.now(); const ms = () => Date.now() - T0;
  if (!hotel || !site || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut) || checkOut <= checkIn) return res.status(200).json({ ok: false, reason: "bad-request" });

  LOG.length = 0;
  const started = Date.now();
  let text = "", finalUrl = "", browser = null, via = "", url = "", link = null, engine = null, candidates = [];
  const looksPriced = (t) => /(?:[$€£]|USD|EUR|GBP)\s?\d{2,3}(?:[,.]\d{3})*|\d{2,3}(?:[,.]\d{3})*\s?(?:USD|EUR|GBP|€|£)/.test(t);
  try {
    // One browser for the whole job (M984): find the hotel's booking link, then read the rates.
    const opened = await openBrowser(); browser = opened.browser; via = opened.via;
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    // 1. The hotel's own booking link, and the engine it belongs to.
    LOG.push({ step: "browser-open", via, ms: ms() });
    try { link = LINK_CACHE[site] || await linkFromRooms(req, hotel, site) || await findBookingLink(site, page, via); if (link) LINK_CACHE[site] = link; } catch (e) { link = null; }
    LOG.push({ step: "link", link, ms: ms() });
    if (stage === "link") { await browser.close(); res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: !!link, stage, link, log: LOG }); }
    if (!link) { await browser.close(); return res.status(200).json({ ok: false, reason: "no-booking-link", hotel, site, log: debug ? LOG : undefined }); }
    engine = ENGINES.find((e) => e.test.test(link));
    const built = engine ? engine.build(link, checkIn, checkOut, pax) : null;
    candidates = Array.isArray(built) ? built.filter(Boolean) : built ? [built] : [];
    if (!candidates.length) { await browser.close(); return res.status(200).json({ ok: false, reason: "unsupported-engine", hotel, link }); }
    url = candidates[0]; finalUrl = url;
    // 2. The rate page for those dates, read as a guest would see it.
    // Tap the cookie banner's Agree/Accept, as a guest would — the Four Seasons app hides the
    // rooms behind it (M983). Harmless on pages without one.
    const agreeCookies = async () => {
      try {
        return await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("button, a, [role=button]"));
          const hit = els.find((el) => /^\s*(agree|accept|accept all|allow all|i agree|ok|got it|accept cookies|accept all cookies)\s*$/i.test((el.innerText || el.textContent || "").trim()));
          if (hit) { hit.click(); return (hit.innerText || hit.textContent || "").trim(); }
          return null;
        });
      } catch (e) { return null; }
    };
    const readText = async () => { try { return await page.evaluate(() => document.body ? document.body.innerText : ""); } catch (e) { return ""; } };
    for (const cand of candidates) {
      url = cand;
      await page.goto(cand, { waitUntil: "domcontentloaded", timeout: 25000 });
      try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }); } catch (e) {}
      let agreed = await agreeCookies();
      // Prices arrive after the app renders: poll for up to 14 s, scrolling so lazy rows appear.
      let t = "";
      for (let i = 0; i < 14; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (!agreed && i === 2) agreed = await agreeCookies();
        try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch (e) {}
        t = await readText();
        if (looksPriced(t)) { await new Promise((r) => setTimeout(r, 1500)); t = await readText(); break; }
      }
      text = t;
      finalUrl = page.url();
      LOG.push({ step: "rates", url: cand, landed: finalUrl, agreed: agreed || null, chars: (text || "").length, priced: looksPriced(text || ""), ms: ms() });
      if (looksPriced(text || "")) break;
      if (Date.now() - started > 70000) break;   // leave time for the reading step
    }
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (x) {} }
    res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: false, reason: "browser", node: process.version, hostedBrowser: !!(process.env.BROWSERLESS_TOKEN || "").trim(), detail: String(e && e.message || e).slice(0, 700), url, log: debug ? LOG : undefined });
  }
  try { await browser.close(); } catch (e) {}
  text = String(text || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 30000);
  if (stage === "page") { res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: true, stage, url: finalUrl, chars: text.length, priced: looksPriced(text), log: LOG, sample: text.slice(0, 4000) }); }
  if (text.length < 200) return res.status(200).json({ ok: false, reason: "empty-page", url, log: debug ? LOG : undefined, sample: debug ? text : undefined });

  // 3. The page as data: rooms and their rate plans, exactly as shown.
  const prompt = `Below is the visible text of a hotel's own booking page for ${hotel}, ${checkIn} to ${checkOut}, ${pax} adult(s). Extract every ROOM/SUITE shown with its RATE PLANS and prices, exactly as displayed.

Return ONLY a JSON object: { "currency": "<ISO code or symbol shown>", "rooms": [ { "name": "<room name as shown>", "plans": [ { "plan": "<rate plan or offer name>", "price": <number>, "perNight": true|false, "cancel": "<cancellation wording or null>", "benefits": "<included benefits wording or null>" } ] } ] }
Rules: price is a plain number (no separators) and perNight is true when the page says per night / avg per night, false when it is the stay total; keep the room and plan names verbatim; include a room with an empty plans list only if the page shows it as sold out or unavailable, and then add "soldOut": true to that room; do not invent anything; if no rooms with prices are visible, return { "currency": null, "rooms": [] }. No prose.

PAGE TEXT
${text}`;
  let parsed = null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) { const detail = await r.text(); return res.status(200).json({ ok: false, reason: "anthropic-error", status: r.status, detail: detail.slice(0, 200) }); }
    const data = await r.json();
    const out = (data.content || []).map((b) => b.text || "").join("").trim();
    const jm = /\{[\s\S]*\}/.exec(out);
    try { parsed = jm ? JSON.parse(jm[0]) : null; } catch (e) { parsed = null; }
    if (!parsed || !Array.isArray(parsed.rooms)) {
      const objs = []; const re = /\{\s*"name"\s*:[\s\S]*?\]\s*\}/g; let m;
      while ((m = re.exec(out))) { try { objs.push(JSON.parse(m[0])); } catch (e) {} }
      const cm = /"currency"\s*:\s*"([^"]*)"/.exec(out);
      parsed = objs.length ? { currency: cm ? cm[1] : null, rooms: objs } : null;
    }
  } catch (e) { parsed = null; }
  if (!parsed || !Array.isArray(parsed.rooms)) return res.status(200).json({ ok: false, reason: "unreadable", url: finalUrl, log: debug ? LOG : undefined, sample: debug ? text.slice(0, 3000) : undefined });

  const currency = parsed.currency ? String(parsed.currency).slice(0, 6) : null;
  const rates = {};
  for (const room of parsed.rooms) {
    if (!room || !room.name) continue;
    const plans = (Array.isArray(room.plans) ? room.plans : []).map((p) => ({
      plan: p && p.plan ? String(p.plan).slice(0, 120) : "Standard rate",
      price: Number(p && p.price), currency, perNight: !!(p && p.perNight),
      cancel: p && p.cancel ? String(p.cancel).slice(0, 160) : null,
      benefits: p && p.benefits ? String(p.benefits).slice(0, 200) : null,
    })).filter((p) => Number.isFinite(p.price) && p.price > 0);
    if (plans.length || room.soldOut) rates[String(room.name).slice(0, 120)] = room.soldOut && !plans.length ? [{ plan: "Sold out", price: 0, currency, perNight: true, cancel: null, benefits: null, soldOut: true }] : plans;
  }
  if (!Object.keys(rates).length) return res.status(200).json({ ok: false, reason: "no-rates-visible", url: finalUrl, log: debug ? LOG : undefined, sample: debug ? text.slice(0, 3000) : undefined });
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=300");
  return res.status(200).json({ ok: true, hotel, checkIn, checkOut, pax, engine: engine.name, source: finalUrl, currency, rates, via: debug ? via : undefined, log: debug ? LOG : undefined, sample: debug ? text.slice(0, 3000) : undefined });
}
