// api/rooms.js — the hotel's own rooms, drawn from the hotel's own website (build M972, 25 Oct 2026).
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

const MODEL = "claude-haiku-4-5-20251001";
const UA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ROOM_PATHS = ["/accommodations", "/accommodations/", "/rooms-suites", "/rooms-and-suites", "/rooms", "/accommodation", "/stay", "/suites", "/rooms-suites/", "/en/rooms", "/en/accommodation", "/en/accommodations", "/en/stay", "/the-rooms", "/villas", "/tents"];

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") || "";
  if (!/html/i.test(ct)) return null;
  const html = await r.text();
  return { url: r.url, html };
}
function abs(base, href) { try { return new URL(href, base).toString(); } catch (e) { return null; } }
// HTML → readable text keeping image addresses and links, so the reader can tie photos to rooms.
function distill(html, base) {
  let h = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<noscript>/gi, "").replace(/<\/noscript>/gi, "");
  h = h.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\b(?:data-src|data-lazy-src|srcset|data-srcset|src)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag);
    let u = src ? src[1].split(",")[0].trim().split(/\s+/)[0] : "";
    if (!u || /^data:/.test(u)) return " ";
    u = abs(base, u); if (!u) return " ";
    return ` [IMG ${u}${alt && alt[1] ? " | " + alt[1].trim() : ""}] `;
  });
  h = h.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi, (tag, href) => { const u = abs(base, href); return u ? ` [LINK ${u}] ` : " "; });
  h = h.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
  h = h.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
  return h.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
// Find the accommodation page: known paths first, then any link on the home page that says rooms.
async function findRoomsPage(site) {
  const base = /^https?:\/\//.test(site) ? site : "https://" + site;
  const origin = new URL(base).origin;
  const root = base.replace(/\/+$/, "");
  const tried = new Set();
  for (const p of ROOM_PATHS) {
    for (const cand of [root + p, origin + p]) {
      if (tried.has(cand)) continue; tried.add(cand);
      try { const got = await get(cand); if (got && /room|suite|villa|tent|bedroom|accommodat/i.test(got.html)) return got; } catch (e) {}
    }
  }
  try {
    const home = await get(root);
    if (home) {
      const links = []; const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
      while ((m = re.exec(home.html)) && links.length < 400) { const u = abs(home.url, m[1]); const txt = m[2].replace(/<[^>]+>/g, " ").trim(); if (u && /(^|\/)(accommodation|accommodations|rooms?|suites?|stay|villas?|tents?|residences?)(\/|$|\?)/i.test(u) || /\b(rooms?|suites?|accommodation|stay)\b/i.test(txt)) links.push(u); }
      for (const u of [...new Set(links)].slice(0, 6)) { if (tried.has(u)) continue; tried.add(u); try { const got = await get(u); if (got && /room|suite|villa/i.test(got.html)) return got; } catch (e) {} }
      return home;   // better than nothing: the reader may still find a rooms section
    }
  } catch (e) {}
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  const hotel = String(req.query.hotel || "").slice(0, 120).trim();
  const site = String(req.query.site || "").slice(0, 300).trim();
  if (!hotel || !site || !/^[a-z0-9.-]+\.[a-z]{2,}/i.test(site.replace(/^https?:\/\//, ""))) return res.status(200).json({ ok: false, reason: "bad-request" });

  let page = null;
  try { page = await findRoomsPage(site); } catch (e) { page = null; }
  if (!page) return res.status(200).json({ ok: false, reason: "unreachable", hotel, site });
  const text = distill(page.html, page.url).slice(0, 70000);
  if (text.length < 300) return res.status(200).json({ ok: false, reason: "empty", hotel, source: page.url });

  const prompt = `Below is the text of a hotel's own website page, with its images shown as [IMG url | alt] and links as [LINK url]. The hotel is "${hotel}". Extract the hotel's ROOM AND SUITE CATEGORIES exactly as the hotel names them.

Return ONLY a JSON object: { "rooms": [ { "name", "category", "size", "beds", "occupancy", "view", "description", "images", "url" } ] }
- name: the room/suite/villa name exactly as written on the page
- category: the section heading it sits under on the page (e.g. "Guest Rooms", "Suites", "Specialty Suites"), or null
- size: the size text as written (e.g. "45–50 m2 (484–538 sq. ft.)"), or null
- beds: bed configuration as written, or null
- occupancy: as written, or null
- view: the view or defining feature as written (terrace, balcony, garden, sea view), or null
- description: the hotel's own one- or two-sentence description of that room if present, else null — never write your own
- images: up to 3 image URLs that belong to this room (the [IMG] entries nearest its name, or whose alt names it); [] if none
- url: the room's own detail page [LINK] if there is one, else null
Rules: list every category once, in page order; do not invent, merge or rename rooms; skip offers, dining, spa and navigation; if the page has no rooms, return { "rooms": [] }. No prose outside the JSON.

PAGE TEXT
${text}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) { const detail = await r.text(); return res.status(200).json({ ok: false, reason: "anthropic-error", status: r.status, detail: detail.slice(0, 200) }); }
    const data = await r.json();
    const out = (data.content || []).map((b) => b.text || "").join("").trim();
    const jm = /\{[\s\S]*\}/.exec(out);
    let parsed; try { parsed = jm ? JSON.parse(jm[0]) : null; } catch (e) { parsed = null; }
    if (!parsed || !Array.isArray(parsed.rooms)) return res.status(200).json({ ok: false, reason: "unreadable", hotel, source: page.url });
    const S = (v, n = 300) => (v == null || v === "" ? null : String(v).trim().slice(0, n));
    const rooms = parsed.rooms.filter((x) => x && x.name).slice(0, 40).map((x) => ({
      name: S(x.name, 120), category: S(x.category, 80), size: S(x.size, 80), beds: S(x.beds, 120), occupancy: S(x.occupancy, 120), view: S(x.view, 120), description: S(x.description, 600),
      images: (Array.isArray(x.images) ? x.images : []).filter((u) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 3),
      url: typeof x.url === "string" && /^https?:\/\//.test(x.url) ? x.url : null,
    }));
    res.setHeader("Cache-Control", "public, s-maxage=2592000, stale-while-revalidate=604800");
    return res.status(200).json({ ok: true, hotel, source: page.url, fetched: new Date().toISOString(), rooms });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch", detail: String(e && e.message || e).slice(0, 200) });
  }
}
