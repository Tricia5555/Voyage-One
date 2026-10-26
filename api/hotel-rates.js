// api/hotel-rates.js — live room rates from the hotel's own booking engine (build M973; puppeteer pairing M976; hosted browser M977; token diagnostics M978; longer answers + salvage M979; link via browser + candidate addresses M981; coded link preferred M982; cookie banner + wait for prices M983; one browser, faster M984; link from rooms reader M985; stages + timings M986; frames + shadow DOM M987; no ad blocker M988; hard 50 s answer M989; network + console diagnostics M990; 6 s link budget + response bodies M991; stage=bundle M992; no rooms=1 M993; price detector + per-request log + own frames only M994; unmatched booking links listed M998; stage=engine probe M999; one step further M1000; Rosewood engine + dates-shown guard M1001; calendar driver probe M1003; real mouse + multi-step M1004; faster probe M1005; ua=native + request headers M1006; stage=calendar direct asks M1007, 25 Oct 2026).
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
    // No ad blocking: booking apps load through tag managers and testing tools (Four Seasons waits
    // for Optimizely before it draws a single room), and a blocker leaves a blank shell (M988).
    const ws = `wss://${region}.browserless.io?token=${encodeURIComponent(token)}&stealth=true&timeout=90000`;
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
      // NO "rooms=1" (M993): the app reads a `rooms` parameter as its list of room occupancies and
      // crashed on the word "1" ("K.map is not a function") on every run since M973 — a parameter
      // I assumed, which the hotel's own form never writes. Only parameters the app itself uses.
      const code = (/(?:locationId|hotelCode)=([A-Z0-9]+)/i.exec(u) || [])[1];
      if (!code) return null;
      return [`https://reservations.fourseasons.com/?hotelCode=${code}&checkIn=${ci}&checkOut=${co}&adults=${pax}&children=0`];
    } },
  // ROSEWOOD (M1001): its own engine on its own domain. The rooms step is
  // /<lang>/<hotel-slug>/reservations/room-booking and the page's own price call uses startDate,
  // endDate, adults, numRooms (seen on the wire, stage=engine, 25 Oct 2026) — nothing invented.
  { name: "rosewood", test: /rosewoodhotels\.com\/[a-z]{2}\/[^/?#]+\/reservations/i, build: (u, ci, co, pax) => {
      const m = /rosewoodhotels\.com\/([a-z]{2})\/([^/?#]+)\/reservations/i.exec(u);
      if (!m) return null;
      return `https://www.rosewoodhotels.com/${m[1]}/${m[2]}/reservations/room-booking?startDate=${ci}&endDate=${co}&adults=${pax}&numRooms=1`;
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
// One log per request (M994): a module-level log was shared by simultaneous requests.
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
async function linkFromRooms(req, hotel, site, LOG) {
  // The rooms reader already holds the hotel's page and is cached for a month: its answer carries
  // the booking link, so this costs milliseconds instead of a browser session (M985).
  try {
    const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    // Six seconds, no more (M991): a cached answer arrives in under one; a cold cache (every deploy
    // clears it) keeps computing on its own and is warm for the next visit, while we scan the site.
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 6000);
    let r = null; try { r = await fetch(`${proto}://${host}/api/rooms?hotel=${encodeURIComponent(hotel)}&site=${encodeURIComponent(site)}&v=2`, { signal: ac.signal }); } finally { clearTimeout(timer); }
    const j = r && r.ok ? await r.json() : null;
    const u = j && j.ok && j.booking ? String(j.booking) : null;
    LOG.push({ step: "find-link", via: "rooms-api", ok: !!u, link: u || undefined });
    return u && ENGINES.some((e) => e.test.test(u)) ? u : null;
  } catch (e) { LOG.push({ step: "find-link", via: "rooms-api", error: /abort/i.test(String(e && e.name || e)) ? "cold cache — warming" : String(e && e.message || e).slice(0, 120) }); return null; }
}
let STAGE = "", CHECK_IN = "", CHECK_OUT = "", CUR_S = null;
async function agreeCookiesQuick(page) { try { await page.evaluate(() => { const els = Array.from(document.querySelectorAll("button, a, [role=button]")); const hit = els.find((el) => /^\s*(accept all cookies|allow all|accept|agree|ok)\s*$/i.test((el.innerText || "").trim())); if (hit) hit.click(); }); } catch (e) {} }
async function findBookingLink(site, page, via, LOG) {
  if (LINK_CACHE[site] && STAGE !== "engine") { LOG.push({ step: "find-link", cached: LINK_CACHE[site] }); return LINK_CACHE[site]; }
  const base = /^https?:\/\//.test(site) ? site : "https://" + site;
  const pages = [base, base.replace(/\/+$/, "") + "/accommodations"];
  // One plain request (fast); a hotel that refuses it gets the browser (M981/M984).
  let got = null; try { got = await fetchText(base); } catch (e) { got = null; }
  LOG.push({ step: "find-link", url: base, via: "fetch", ok: !!got });
  if (got && STAGE !== "engine") { const u = linkIn(got.html, got.url); if (u) { LINK_CACHE[site] = u; return u; } }
  for (const p of pages) {
    try {
      await page.goto(p, { waitUntil: "domcontentloaded", timeout: 20000 });
      try { await page.waitForNetworkIdle({ idleTime: 600, timeout: 6000 }); } catch (e) {}
      // Buttons too, and the addresses a "Book" button opens by script (data-href, data-url, onclick) —
      // an unknown engine shows itself here (M998).
      const hrefs = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll("a[href]").forEach((a) => out.push(a.href));
        document.querySelectorAll("[data-href],[data-url],[data-booking-url],[data-link],button[onclick],a[onclick],[data-target]").forEach((el) => { for (const k of ["data-href", "data-url", "data-booking-url", "data-link", "onclick", "data-target"]) { const v = el.getAttribute(k); if (v) { const m = /https?:\/\/[^"'\s)]+/.exec(v); if (m) out.push(m[0]); } } });
        return out;
      });
      LOG.push({ step: "find-link", url: p, via: "browser:" + via, links: hrefs.length });
      const u = bestLink(hrefs);
      if (u && STAGE !== "engine") { LINK_CACHE[site] = u; return u; }
      // No known engine: show what looked like a booking link, so the engine can be added.
      const bookish = [...new Set(hrefs.filter((x) => /book|reserv|availability|stay|rates|checkin|check-in/i.test(x) && !/blog|press|news|career|gift|shop|restaurant|dining|spa|event|wedding|meeting|offer|privacy|terms/i.test(x)))].slice(0, 15);
      if (bookish.length) LOG.push({ step: "find-link", url: p, unmatched: bookish });
      // stage=engine (M999): open the hotel's own reservations page and report where it lands, what
      // it embeds and what date fields it shows — so an unknown engine can be added as one line.
      if (STAGE === "engine" && (u || bookish.length)) {
        const own = u || bookish.find((x) => /reserv|book/i.test(x) && !/sevenrooms|opentable|resy|facebook|instagram/i.test(x)) || bookish[0];
        try {
          await page.goto(own, { waitUntil: "domcontentloaded", timeout: 25000 });
          try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 10000 }); } catch (e) {}
          await new Promise((r) => setTimeout(r, 1200));
          const probe = STAGE === "engine" ? { title: await page.title() } : await page.evaluate(() => ({
            title: document.title,
            inputs: Array.from(document.querySelectorAll("input, select")).slice(0, 40).map((i) => ({ name: i.name || null, id: i.id || null, type: i.type || i.tagName.toLowerCase(), placeholder: i.placeholder || null, aria: i.getAttribute("aria-label") || null })),
            forms: Array.from(document.querySelectorAll("form")).slice(0, 5).map((f) => ({ action: f.action || null, method: f.method || null })),
            buttons: Array.from(document.querySelectorAll("button, a[role=button]")).map((b) => (b.innerText || "").trim()).filter(Boolean).slice(0, 25),
            scripts: Array.from(document.scripts).map((s) => s.src).filter((s) => /synxis|travelclick|ihotelier|sabre|pegasus|shr|windsurfer|siteminder|cloudbeds|mews|opera|oracle|simplebooking|bookingengine|booking-engine|be\./i.test(s)).slice(0, 10),
          }));
          if (STAGE === "engine") { /* fast path: no inputs/buttons inventory on the first page */ }
          LOG.push({ step: "engine", opened: own, landed: page.url(), frames: page.frames().map((f) => f.url()).filter((u) => u && u !== "about:blank").slice(0, 10), ...probe });
          // One step further (M1000): the hidden codes, the "Rooms / Stay" choice clicked, the next
          // page's address and fields, and any date-parameter names in the site's own script.
          try {
            const codes = await page.evaluate(() => Array.from(document.querySelectorAll("input[type=hidden]")).filter((i) => /code|property|hotel|chain|brand/i.test(i.name || i.id || "")).map((i) => ({ name: i.name || i.id, value: String(i.value || "").slice(0, 40) })));
            try { await page.evaluate(() => { const els = Array.from(document.querySelectorAll("button, a, [role=button]")); const hit = els.find((el) => /^\s*(accept all cookies|allow all|accept|agree)\s*$/i.test((el.innerText || "").trim())); if (hit) hit.click(); }); await new Promise((r) => setTimeout(r, 800)); } catch (e) {}
            const choice = await page.evaluate(() => {
              const els = Array.from(document.querySelectorAll("a, button, [role=button], [role=link], label, li, div[tabindex]"));
              const hit = els.find((el) => /^\s*(rooms?(\s*(&|and)\s*suites)?|stay|accommodations?|book a room|hotel stay|room reservation)\s*$/i.test((el.innerText || "").trim()));
              if (hit) { const txt = (hit.innerText || "").trim(); hit.click(); return txt; }
              return null;
            });
            await new Promise((r) => setTimeout(r, 2000));
            try { await page.waitForNetworkIdle({ idleTime: 600, timeout: 5000 }); } catch (e) {}
            const next = await page.evaluate(() => ({
              title: document.title,
              inputs: Array.from(document.querySelectorAll("input, select")).filter((i) => !/ot-|vendor|cookie|chkbox|select-all/i.test(i.name || i.id || "")).slice(0, 30).map((i) => ({ name: i.name || null, id: i.id || null, type: i.type || i.tagName.toLowerCase(), placeholder: i.placeholder || null, aria: i.getAttribute("aria-label") || null, value: /date|check|arriv|depart/i.test(i.name || i.id || i.placeholder || "") ? String(i.value || "").slice(0, 20) : undefined })),
              links: Array.from(document.querySelectorAll("a[href]")).map((a) => a.href).filter((u) => /reserv|book|room|avail|search/i.test(u) && !/sevenrooms|facebook|instagram/i.test(u)).slice(0, 12),
              buttons: Array.from(document.querySelectorAll("button, a[role=button]")).map((b) => (b.innerText || "").trim()).filter((x) => x && !/cookie|accept|reject|allow|confirm my|privacy/i.test(x)).slice(0, 20),
            }));
            const scripts = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).filter((s) => s && !/onetrust|cookielaw|google|gtm|facebook|hotjar|optimizely|adobe|tealium|clarity/i.test(s)).slice(0, 12));
            let params = [];
            for (const s of scripts.slice(0, 0)) {
              try { const txt = await page.evaluate(async (u) => { const r = await fetch(u); return (await r.text()).slice(0, 2000000); }, s);
                const found = new Set(); let m; const re = /["'`]([a-zA-Z_]*(?:checkin|checkout|check_in|check_out|arrival|departure|arrive|depart|startDate|endDate|start_date|end_date|dateIn|dateOut|datein|dateout|fromDate|toDate|adults|guests|rooms)[a-zA-Z_]*)["'`]/g;
                while ((m = re.exec(txt)) && found.size < 30) found.add(m[1]);
                const urls = new Set(); const re2 = /["'`]((?:https?:)?\/\/[^"'`\s]{0,80}(?:reserv|book|avail|search)[^"'`\s]{0,80})["'`]|["'`](\/[a-z0-9\-\/]{0,60}(?:reserv|book|avail|search)[a-z0-9\-\/]{0,60}\??[^"'`\s]{0,80})["'`]/gi;
                while ((m = re2.exec(txt)) && urls.size < 20) urls.add(m[1] || m[2]);
                params.push({ script: s.slice(-60), params: [...found], urls: [...urls] }); } catch (e) {}
            }
            LOG.push({ step: "engine-next", codes, clicked: choice, landed: page.url(), frames: page.frames().map((f) => f.url()).filter((u) => u && u !== "about:blank").slice(0, 10), ...next, scripts: params });
            // DRIVE THE CALENDAR AS A GUEST WOULD (M1003; real mouse presses + multi-step M1004):
            // open the date field, move to the month, press check-in and check-out with the
            // mouse, press Continue up to three times (dates → guests → search), and report after
            // each press: the address, whether prices appeared, the price calls, a glimpse of text.
            try {
              const [ciY, ciM, ciD] = CHECK_IN.split("-").map(Number), [coY, coM, coD] = CHECK_OUT.split("-").map(Number);
              const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
              const apiMark = CUR_S ? CUR_S.api.length : 0;
              const press = async (finder, arg) => {   // a real mouse press on the element the finder returns
                const jh = await page.evaluateHandle(finder, arg); const el = jh.asElement();
                if (!el) return null;
                try { await el.evaluate((n) => n.scrollIntoView({ block: "center" })); } catch (e) {}
                const label = await el.evaluate((n) => (n.innerText || n.value || n.getAttribute("aria-label") || "").trim().slice(0, 40));
                try { await el.click({ delay: 40 }); } catch (e) { await el.evaluate((n) => n.click()); }
                return label || true;
              };
              const steps = [];
              const opened = await press(() => Array.from(document.querySelectorAll("button, [role=button], input, div, span, label, a")).find((el) => /^(date|dates|select dates|check-?in|check-?in date|arrival|arrive)$/i.test(((el.innerText || el.value || el.placeholder || "")).trim())) || null);
              await new Promise((r) => setTimeout(r, 1200));
              const pickDay = async (y, m, d) => {
                const want = `${MONTHS[m - 1]} ${y}`;
                for (let i = 0; i < 14; i++) {
                  const has = await page.evaluate((want) => Array.from(document.querySelectorAll("*")).some((el) => el.children.length === 0 && (el.innerText || el.textContent || "").trim().toLowerCase() === want.toLowerCase()), want);
                  if (has) break;
                  const moved = await press(() => Array.from(document.querySelectorAll("button, [role=button], a, span, div")).find((el) => /next|forward/i.test(el.getAttribute("aria-label") || "") || /next/i.test(el.className || "") || /^(›|>|→|»)$/.test((el.innerText || "").trim())) || null);
                  if (!moved) return { ok: false, why: "no next-month control" };
                  await new Promise((r) => setTimeout(r, 500));
                }
                const hit = await press((a) => {
                  const [want, d] = a; const all = Array.from(document.querySelectorAll("*"));
                  const label = all.find((el) => el.children.length === 0 && (el.innerText || el.textContent || "").trim().toLowerCase() === want.toLowerCase());
                  if (!label) return null;
                  const days = all.filter((el) => el.children.length === 0 && (el.innerText || el.textContent || "").trim() === String(d) && (label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
                  const up = (el) => { let n = el; for (let i = 0; i < 4 && n; i++) { if (n.tagName === "BUTTON" || n.getAttribute("role") === "button" || n.getAttribute("role") === "gridcell" || n.tagName === "TD") return n; n = n.parentElement; } return el; };
                  return days.map(up).find((el) => !el.disabled && el.getAttribute("aria-disabled") !== "true" && !/disabled|past|unavailable/i.test(el.className || "")) || null;
                }, [want, d]);
                return hit ? { ok: true, picked: `${want} ${d}` } : { ok: false, why: "day not found/clickable" };
              };
              const p1 = await pickDay(ciY, ciM, ciD); await new Promise((r) => setTimeout(r, 700));
              const p2 = p1.ok ? await pickDay(coY, coM, coD) : null; await new Promise((r) => setTimeout(r, 900));
              const shown = await page.evaluate(() => (document.body ? document.body.innerText : "").replace(/\s+/g, " ").slice(0, 400));
              for (let k = 0; k < 3; k++) {
                const pressed = await press(() => Array.from(document.querySelectorAll("button, [role=button], a, input[type=submit]")).find((el) => { const t = ((el.innerText || el.value || "")).trim(); const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && /^(continue|search|check availability|view rates|find rooms|see rooms|book now|apply|done|next|confirm)$/i.test(t); }) || null);
                if (!pressed) { steps.push({ pressed: null }); break; }
                try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }); } catch (e) {}
                await new Promise((r) => setTimeout(r, 2000));
                const txt = await page.evaluate(() => (document.body ? document.body.innerText : "").replace(/\s+/g, " "));
                const priced = /(?:[$€£]|USD|EUR|GBP)\s?\d{2,}/.test(txt);
                steps.push({ pressed, landed: page.url(), priced, calls: (CUR_S ? CUR_S.api : []).slice(apiMark).filter((c) => /catalog|avail|rate|room|price|search|book/i.test(c.u) && !/pinterest|doubleclick|nr-data|google/i.test(c.u)).map((c) => ({ s: c.s, m: c.m, u: c.u.slice(0, 200), body: c.body ? c.body.slice(0, 300) : undefined })).slice(0, 10), text: txt.slice(0, 700) });
                if (priced) break;
              }
              LOG.push({ step: "engine-dates", opened, pick: [p1, p2], afterPick: shown, steps, calendarCalls: (CUR_S ? CUR_S.api : []).slice(apiMark).filter((c) => /catalog|calendar|avail|rate/i.test(c.u)).map((c) => ({ s: c.s, u: c.u.slice(0, 220), body: c.body ? c.body.slice(0, 300) : undefined, req: c.req })).slice(0, 8) });
            } catch (e) { LOG.push({ step: "engine-dates", error: String(e && e.message || e).slice(0, 200) }); }
          } catch (e) { LOG.push({ step: "engine-next", error: String(e && e.message || e).slice(0, 200) }); }
        } catch (e) { LOG.push({ step: "engine", opened: own, error: String(e && e.message || e).slice(0, 200) }); }
        return u || null;
      }
    } catch (e) { LOG.push({ step: "find-link", url: p, via: "browser", error: String(e && e.message || e).slice(0, 200) }); }
  }
  return null;
}

// A HARD 50-SECOND ANSWER (M989). Safari drops a request at about 60 s and the client sees a dead
// page — and we see nothing at all, not even the log. Whatever has happened by 50 s is sent back
// as the answer: the log, the characters read so far, a glimpse of the page. Slow is reported;
// silent is forbidden.
export default async function handler(req, res) {
  const S = { text: "", url: "", htmlPeek: "", browser: null, sent: false, t0: Date.now(), net: [], api: [], console: [], log: [] };
  const json = res.json.bind(res);
  res.json = (b) => { if (S.sent) return res; S.sent = true; return json(b); };
  const timer = new Promise((r) => setTimeout(r, 50000, "timeout"));
  let outcome = "done";
  try { outcome = await Promise.race([work(req, res, S).then(() => "done"), timer]); } catch (e) { outcome = "error:" + String(e && e.message || e).slice(0, 200); }
  if (!S.sent) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: false, reason: outcome === "timeout" ? "timeout" : "error", detail: outcome, ms: Date.now() - S.t0, url: S.url, chars: S.text.length, log: S.log, sample: S.text.slice(0, 4000), htmlPeek: S.text.length < 200 ? S.htmlPeek : undefined, net: S.net, api: S.api, console: S.console });
  }
  if (S.browser) { try { S.browser.close().catch(() => {}); } catch (e) {} }
}

async function work(req, res, S) {
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
  const nativeUA = String(q.ua || "") === "native";   // M1006: arrive as the browser really is (no iPad disguise)
  const stage = String(q.stage || "");   // "link" | "page" | "bundle" | "engine" | "" (full) — M986/M992/M999 diagnostics
  STAGE = stage; CHECK_IN = checkIn; CHECK_OUT = checkOut; CUR_S = S;
  const T0 = Date.now(); const ms = () => Date.now() - T0;
  if (!hotel || !site || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut) || checkOut <= checkIn) return res.status(200).json({ ok: false, reason: "bad-request" });

  const LOG = S.log;
  const started = Date.now();
  let text = "", finalUrl = "", browser = null, via = "", url = "", link = null, engine = null, candidates = [], htmlPeek = "";
  // A price: a currency mark beside a number of at least two digits, with or without thousands
  // separators ("EUR 2,036", "$1,468", "850 €"). M993's detector missed every separated price.
  const looksPriced = (t) => /(?:[$€£]|USD|EUR|GBP|CHF|AED|JPY)\s?(?:\d{1,3}(?:[,.]\d{3})+|\d{2,})(?!\d)|(?:\d{1,3}(?:[,.]\d{3})+|\d{2,})\s?(?:USD|EUR|GBP|CHF|AED|€|£)(?![A-Za-z])/.test(t);
  try {
    // One browser for the whole job (M984): find the hotel's booking link, then read the rates.
    const opened = await openBrowser(); browser = opened.browser; via = opened.via; S.browser = browser;
    const page = await browser.newPage();
    if (!nativeUA) await page.setUserAgent(UA);
    LOG.push({ step: "ua", mode: nativeUA ? "native" : "ipad", agent: (await browser.userAgent()).slice(0, 120) });
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    // What the app itself sees (M990): failed requests, its API calls, and its error console. A
    // page that draws nothing explains itself here, not in its text.
    const NOISE = /cookielaw|onetrust|optimizely|apm\.|\/akam\/|google|facebook|doubleclick|smooch|fonts\./i;
    page.on("response", async (r) => {
      try {
        const s = r.status(); const u = r.url(); const ty = r.request().resourceType();
        const data = (ty === "xhr" || ty === "fetch") && !NOISE.test(u);
        const telling = s >= 400 || /avail|rate|room|price|search|tretail|book/i.test(u);
        let body; if (data && telling && S.api.length < 40) { try { body = (await r.text()).replace(/\s+/g, " ").slice(0, 400); } catch (e) { body = undefined; } }
        if (s >= 400 && S.net.length < 40) S.net.push({ s, u: u.slice(0, 160), body });
        if (data && S.api.length < 40) S.api.push({ s, u: u.slice(0, 160), m: r.request().method(), body: telling ? body : undefined, req: /calendar|avail|catalog/i.test(u) ? (() => { const hh = r.request().headers() || {}; const keep = {}; for (const k of Object.keys(hh)) if (!/^(cookie|authorization)$/i.test(k)) keep[k] = String(hh[k]).slice(0, 120); return keep; })() : undefined });
      } catch (e) {}
    });
    page.on("requestfailed", (r) => { try { if (S.net.length < 40) S.net.push({ s: "failed", u: r.url().slice(0, 160), e: ((r.failure() || {}).errorText || "").slice(0, 60) }); } catch (e) {} });
    page.on("console", (m) => { try { if (m.type() === "error" && S.console.length < 20) S.console.push(m.text().slice(0, 240)); } catch (e) {} });
    page.on("pageerror", (e) => { try { if (S.console.length < 20) S.console.push("pageerror: " + String(e && e.stack || e && e.message || e).slice(0, 600)); } catch (x) {} });
    // 1. The hotel's own booking link, and the engine it belongs to.
    LOG.push({ step: "browser-open", via, ms: ms() });
    try { link = stage === "engine" ? await findBookingLink(site, page, via, LOG) : (LINK_CACHE[site] || await linkFromRooms(req, hotel, site, LOG) || await findBookingLink(site, page, via, LOG)); if (link) LINK_CACHE[site] = link; } catch (e) { link = null; }
    LOG.push({ step: "link", link, ms: ms() });
    if (stage === "calendar") {
      // ASK THE ENGINE DIRECTLY (M1007): open the rooms step of the hotel's own booking flow, then,
      // from inside that page (its cookies, its key), call its calendar service several ways and
      // report each reply — and the hotel's own record, which may name the id the calendar wants.
      const out = { stage, link };
      try {
        const base = /rosewoodhotels\.com\/([a-z]{2})\/([^/?#]+)\/reservations/i.exec(link || "");
        const roomsUrl = base ? `https://www.rosewoodhotels.com/${base[1]}/${base[2]}/reservations/room-booking` : link;
        await page.goto(roomsUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }); } catch (e) {}
        await agreeCookiesQuick(page);
        await new Promise((r) => setTimeout(r, 1500));
        const slug = base ? base[2] : "";
        out.tries = await page.evaluate(async (a) => {
          const [slug, ci, co] = a;
          const key = (() => { try { const perf = performance.getEntriesByType("resource").map((e) => e.name); return perf.find((n) => /catalog\/v1/.test(n)) ? "seen" : "none"; } catch (e) { return "?"; } })();
          const hdr = { accept: "application/json" };
          const variants = [
            `/api/catalog/v1/hotel/${slug}`,
            `/api/catalog/v1/room/calendar?hotelId=${slug}&startDate=2026-11-01&endDate=2026-11-30&numRooms=1&adults=2&childrenCountPerRoom=0`,
            `/api/catalog/v1/room/calendar?hotelId=${slug}&startDate=2026-11-01&endDate=2026-11-30&numRooms=1&adults=2&childrenCountPerRoom=0&currencyCode=EUR&timeZone=Europe/Madrid`,
            `/api/catalog/v1/room/calendar?hotelId=${slug}&startDate=${ci}&endDate=${co}&numRooms=1&adults=2&childrenCountPerRoom=0&currencyCode=EUR&timeZone=Europe/Madrid&userSelectedDates=true`,
            `/api/catalog/v1/room/availability?hotelId=${slug}&startDate=${ci}&endDate=${co}&numRooms=1&adults=2&childrenCountPerRoom=0&currencyCode=EUR`,
            `/api/catalog/v1/rooms?hotelId=${slug}&startDate=${ci}&endDate=${co}&numRooms=1&adults=2&childrenCountPerRoom=0&currencyCode=EUR`,
            `/api/catalog/v1/hotel/${slug}/rooms?startDate=${ci}&endDate=${co}&adults=2&numRooms=1`,
          ];
          const res = [];
          for (const v of variants) {
            try { const r = await fetch(v, { headers: hdr, credentials: "include" }); const t = await r.text(); res.push({ u: v, s: r.status, body: t.replace(/\s+/g, " ").slice(0, v.includes("/hotel/") && !v.includes("rooms") ? 1800 : 500) }); }
            catch (e) { res.push({ u: v, error: String(e && e.message || e).slice(0, 100) }); }
          }
          return { keySeen: key, res };
        }, [slug, checkIn, checkOut]);
      } catch (e) { out.error = String(e && e.message || e).slice(0, 200); }
      await browser.close(); res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: true, ...out, log: LOG });
    }
    if (stage === "link" || stage === "engine") { await browser.close(); res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: !!link, stage, link, log: LOG }); }
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
    // Read the text of EVERY frame and every sealed (shadow) component, not just the outer page —
    // the Four Seasons app rendered zero visible characters to the plain read (M987).
    const deepText = () => {
      const seen = new Set();
      const walk = (root) => {
        let out = "";
        const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          if (n.nodeType === 3) {
            const pt = n.parentNode && n.parentNode.tagName;
            if (pt && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(pt)) continue;
            const t = n.textContent; if (t && t.trim()) out += t.trim() + " ";
          } else {
            if (n.shadowRoot && !seen.has(n.shadowRoot)) { seen.add(n.shadowRoot); out += walk(n.shadowRoot); }
            if (/^(P|DIV|LI|TR|H[1-6]|SECTION|ARTICLE|BUTTON)$/.test(n.tagName)) out += String.fromCharCode(10);
          }
        }
        return out;
      };
      return walk(document.body || document.documentElement);
    };
    const readText = async () => {
      let out = "";
      const within = (p, n) => Promise.race([p, new Promise((r) => setTimeout(() => r(""), n))]);
      const own = (f) => { try { const u = f.url() || ""; return f === page.mainFrame() || !u || u === "about:blank" || /^about:srcdoc/.test(u) || new URL(u).host === new URL(page.url()).host; } catch (e) { return false; } };
      try { for (const f of page.frames()) { if (!own(f)) continue; try { out += (await within(f.evaluate(deepText), 1500)) + "\n"; } catch (e) {} } } catch (e) {}
      if (!out.trim()) { try { out = await page.evaluate(() => document.body ? document.body.innerText : ""); } catch (e) {} }
      return out;
    };
    const pageSize = async () => { try { return (await page.content()).length; } catch (e) { return 0; } };
    for (const cand of candidates) {
      url = cand;
      S.url = cand;
      await page.goto(cand, { waitUntil: "domcontentloaded", timeout: 20000 });
      try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 10000 }); } catch (e) {}
      if (stage === "bundle") {
        // READ THE APP'S OWN CODE (M992). Its script is public and names every service address it
        // calls — the room-level rate call among them — and the exact code that crashes in our browser.
        await new Promise((r) => setTimeout(r, 5000));   // let the app run far enough to crash
        const scripts = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).filter(Boolean));
        const main = scripts.find((s) => /\/main\.[a-z0-9]+\.js|\/main\.js|\/app\.[a-z0-9]+\.js|bundle/i.test(s)) || scripts[scripts.length - 1] || null;
        let src = ""; if (main) { try { src = await page.evaluate(async (u) => { const r = await fetch(u); return await r.text(); }, main); } catch (e) { src = ""; } }
        const found = new Set(); let m;
        const re1 = /["'`]([^"'`\n]{0,120}?tretail\/[^"'`\n]{0,160})["'`]/g; while ((m = re1.exec(src)) && found.size < 80) found.add(m[1]);
        const re2 = /["'`]((?:\/|https?:\/\/)[^"'`\n]{0,60}(?:availab|rate|room|book|offer|search)[^"'`\n]{0,100})["'`]/gi; while ((m = re2.exec(src)) && found.size < 160) found.add(m[1]);
        const wait = /\.js:(\d+):(\d+)/.exec(S.console.join("\n"));
        let crash = ""; if (wait && src) { const lineNo = +wait[1], col = +wait[2]; let p = 0; for (let i = 1; i < lineNo; i++) { const nl = src.indexOf("\n", p); if (nl < 0) break; p = nl + 1; } crash = src.slice(Math.max(0, p + col - 1200), p + col + 400); }
        await browser.close(); res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ ok: !!src, stage, script: main, size: src.length, endpoints: [...found], crashAt: wait ? wait[0] : null, crash, console: S.console, log: LOG });
      }
      let agreed = await agreeCookies();
      if (agreed) { try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 5000 }); } catch (e) {} }
      // Prices arrive after the app renders: poll for up to 14 s, scrolling so lazy rows appear.
      let t = "";
      for (let i = 0; i < 14; i++) {
        if (ms() > 45000) break;   // keep the whole answer inside Safari's patience
        await new Promise((r) => setTimeout(r, 1000));
        if (!agreed && i === 2) agreed = await agreeCookies();
        try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch (e) {}
        t = await readText(); S.text = t;
        if (looksPriced(t)) { await new Promise((r) => setTimeout(r, 1500)); t = await readText(); break; }
      }
      text = t; S.text = t;
      finalUrl = page.url(); S.url = finalUrl;
      if ((t || "").trim().length < 200) { try { const full = (await page.content()).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/\s+/g, " "); const bi = full.indexOf("<body"); htmlPeek = (bi >= 0 ? full.slice(bi) : full).slice(0, 3000); S.htmlPeek = htmlPeek; } catch (e) {} }
      LOG.push({ step: "rates", url: cand, landed: finalUrl, agreed: agreed || null, chars: (text || "").length, html: await pageSize(), frames: page.frames().length, priced: looksPriced(text || ""), ms: ms() });
      if (looksPriced(text || "")) break;
      if (Date.now() - started > 25000) break;   // Safari gives up at ~60 s: a second try only when the first failed fast
    }
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (x) {} }
    res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: false, reason: "browser", node: process.version, hostedBrowser: !!(process.env.BROWSERLESS_TOKEN || "").trim(), detail: String(e && e.message || e).slice(0, 700), url, log: debug ? LOG : undefined });
  }
  try { await browser.close(); } catch (e) {}
  text = String(text || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 30000);
  if (stage === "page") { res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: true, stage, url: finalUrl, chars: text.length, priced: looksPriced(text), log: LOG, sample: text.slice(0, 4000), htmlPeek: text.length < 200 ? htmlPeek : undefined, net: S.net, api: S.api, console: S.console }); }
  if (text.length < 200) return res.status(200).json({ ok: false, reason: "empty-page", url, log: debug ? LOG : undefined, sample: debug ? text : undefined });
  // THE PAGE MUST SHOW THE CLIENT'S DATES (M1001). A date parameter the engine ignored would leave
  // the page on its default dates and the prices would be for the wrong stay. The check-in date
  // must appear on the page in some common form, or no price is returned at all.
  const showsDate = (() => {
    const [y, mo, d] = checkIn.split("-").map(Number);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const full = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const mm = String(mo).padStart(2, "0"), dd = String(d).padStart(2, "0");
    const forms = [checkIn, `${mm}/${dd}/${y}`, `${dd}/${mm}/${y}`, `${mo}/${d}/${y}`, `${d}/${mo}/${y}`, `${dd}.${mm}.${y}`, `${months[mo - 1]} ${d}`, `${d} ${months[mo - 1]}`, `${full[mo - 1]} ${d}`, `${d} ${full[mo - 1]}`, `${months[mo - 1]}\u00a0${d}`];
    const t = text.replace(/\u00a0/g, " ");
    return forms.some((f) => t.includes(f.replace(/\u00a0/g, " ")));
  })();
  if (!showsDate) { res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: false, reason: "dates-not-applied", url: finalUrl, checkIn, log: debug ? LOG : undefined, sample: debug ? text.slice(0, 3000) : undefined }); }

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
