// api/hotel-rates.js — live room rates from the hotel's own booking engine (build M973; puppeteer pairing M976; hosted browser M977; token diagnostics M978, 25 Oct 2026).
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
    const ws = `wss://${region}.browserless.io?token=${encodeURIComponent(token)}&stealth=true&blockAds=true`;
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
      const code = (/(?:locationId|hotelCode)=([A-Z0-9]+)/i.exec(u) || [])[1];
      if (!code) return null;
      return `https://reservations.fourseasons.com/?hotelCode=${code}&checkIn=${ci}&checkOut=${co}&adults=${pax}&children=0&rooms=1`;
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
async function findBookingLink(site) {
  const base = /^https?:\/\//.test(site) ? site : "https://" + site;
  const pages = [base, base.replace(/\/+$/, "") + "/accommodations", base.replace(/\/+$/, "") + "/rooms"];
  for (const p of pages) {
    let got = null; try { got = await fetchText(p); } catch (e) { got = null; }
    if (!got) continue;
    const re = /href\s*=\s*["']([^"']+)["']/gi; let m;
    while ((m = re.exec(got.html))) {
      let u; try { u = new URL(m[1], got.url).toString(); } catch (e) { continue; }
      if (ENGINES.some((e) => e.test.test(u))) return u;
    }
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
  if (!hotel || !site || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut) || checkOut <= checkIn) return res.status(200).json({ ok: false, reason: "bad-request" });

  // 1. The hotel's own booking link, and the engine it belongs to.
  let link = null; try { link = await findBookingLink(site); } catch (e) { link = null; }
  if (!link) return res.status(200).json({ ok: false, reason: "no-booking-link", hotel, site });
  const engine = ENGINES.find((e) => e.test.test(link));
  const url = engine ? engine.build(link, checkIn, checkOut, pax) : null;
  if (!url) return res.status(200).json({ ok: false, reason: "unsupported-engine", hotel, link });

  // 2. A real browser opens the rate page for those dates and reads what a guest would see.
  let text = "", finalUrl = url, browser = null, via = "";
  try {
    const opened = await openBrowser(); browser = opened.browser; via = opened.via;
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }); } catch (e) {}
    // Prices arrive after the app renders; give it a moment, then scroll so lazy rows appear.
    await new Promise((r) => setTimeout(r, 2500));
    try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await new Promise((r) => setTimeout(r, 1500)); } catch (e) {}
    text = await page.evaluate(() => document.body ? document.body.innerText : "");
    finalUrl = page.url();
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (x) {} }
    res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: false, reason: "browser", node: process.version, hostedBrowser: !!(process.env.BROWSERLESS_TOKEN || "").trim(), detail: String(e && e.message || e).slice(0, 700), url });
  }
  try { await browser.close(); } catch (e) {}
  text = String(text || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 60000);
  if (text.length < 200) return res.status(200).json({ ok: false, reason: "empty-page", url, sample: debug ? text : undefined });

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
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) { const detail = await r.text(); return res.status(200).json({ ok: false, reason: "anthropic-error", status: r.status, detail: detail.slice(0, 200) }); }
    const data = await r.json();
    const out = (data.content || []).map((b) => b.text || "").join("").trim();
    const jm = /\{[\s\S]*\}/.exec(out); parsed = jm ? JSON.parse(jm[0]) : null;
  } catch (e) { parsed = null; }
  if (!parsed || !Array.isArray(parsed.rooms)) return res.status(200).json({ ok: false, reason: "unreadable", url: finalUrl, sample: debug ? text.slice(0, 3000) : undefined });

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
  if (!Object.keys(rates).length) return res.status(200).json({ ok: false, reason: "no-rates-visible", url: finalUrl, sample: debug ? text.slice(0, 3000) : undefined });
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=300");
  return res.status(200).json({ ok: true, hotel, checkIn, checkOut, pax, engine: engine.name, source: finalUrl, currency, rates, via: debug ? via : undefined, sample: debug ? text.slice(0, 3000) : undefined });
}
