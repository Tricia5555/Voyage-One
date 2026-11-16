// api/covers.js — THE COVER PICKER (M1078, 16 Nov 2026).
//
// Tricia chooses one cover photograph for each place the site carries. This page shows two
// photographs of a place; she taps one, it is saved, and the next place comes up.
//
// The photographs come from Wikimedia Commons, which are free to keep and to use commercially
// with the photographer credited. The page asks Commons for them from her own browser; nothing
// here costs anything, and Google is not involved.
//
// A choice is saved in the `place_ids` table (the one the restaurant inventory uses) as a row of
// kind "cover", so no new table is needed:
//     name    = the photograph's file name on Commons
//     site    = the address of the picture itself (a wide copy, served by Wikimedia)
//     address = the photographer
//     phone   = the licence ("CC BY-SA 4.0")
//     area    = the photograph's page on Commons (where the credit links)
// api/cityphoto.js reads that row before it asks Google.
//
// PRIVATE BY A CODE IN THE LINK (M1078). It runs on the live site, so Tricia needs no staging copy
// and no extra sign-in, but it answers only to a link carrying her code. This file is public on
// GitHub, so the code itself is not written here: only its fingerprint (SHA-256) is, which cannot
// be turned back into the code. Without the code nobody can open the picker or change a cover.
// Open:  https://voyageoneworld.com/api/covers?k=<her code>
import { createHash } from "node:crypto";
import { COVER_CITIES, COVER_HINTS } from "./_cover-cities.js";

const CODE_PRINT = "7a9543b81dbfb266df6a57e31dedf7d81a096463e5f6f94a60ab10f7cb78beee";
const rightCode = (k) => createHash("sha256").update(String(k || "")).digest("hex") === CODE_PRINT;

const SB = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SBK = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SBH = () => ({ apikey: SBK, Authorization: `Bearer ${SBK}`, "Content-Type": "application/json" });
// The same key api/cityphoto.js makes: lower case, and without a trailing airport code.
const coverKey = (s) => String(s || "").replace(/\s*\([A-Z]{3}\)\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
const clip = (s, n) => String(s || "").slice(0, n);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!rightCode(req.query.k)) return res.status(403).json({ ok: false, reason: "This page needs its private link." });
  if (!SB || !SBK) return res.status(200).json({ ok: false, reason: "not configured" });

  // Saving one choice.
  if (req.method === "POST") {
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = null; } }
    const city = b && clip(b.city, 120).trim();
    const url = b && clip(b.url, 900);
    if (!city || !/^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(url || "")) return res.status(200).json({ ok: false, reason: "That is not a Wikimedia photograph." });
    const row = { kind: "cover", city_key: coverKey(city), name_key: "cover", city, name: clip(b.file, 300), site: url, address: clip(b.by, 200), phone: clip(b.lic, 60), area: clip(b.page, 600), updated_at: new Date().toISOString() };
    const r = await fetch(`${SB}/rest/v1/place_ids?on_conflict=kind,city_key,name_key`, { method: "POST", headers: { ...SBH(), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([row]) });
    if (!r.ok) return res.status(200).json({ ok: false, reason: `Saving failed (${r.status}).` });
    return res.status(200).json({ ok: true, city });
  }

  // What has been chosen so far.
  if (req.query.done === "1") {
    const r = await fetch(`${SB}/rest/v1/place_ids?select=city_key,city,site,address&kind=eq.cover&limit=5000`, { headers: SBH() });
    if (!r.ok) return res.status(200).json({ ok: false, reason: "could not read the choices" });
    return res.status(200).json({ ok: true, done: await r.json() });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(PAGE.replace("__CITIES__", JSON.stringify(COVER_CITIES).replace(/</g, "\\u003c")).replace("__HINTS__", JSON.stringify(COVER_HINTS).replace(/</g, "\\u003c")));
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voyage One covers</title>
<style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #f6f2ea; color: #221d19; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 16px 16px 60px; }
  .top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .count { font-size: 14px; color: #6b6259; }
  h1 { font-family: Georgia, serif; font-weight: 400; font-size: 34px; margin: 10px 0 12px; }
  .pair { display: grid; grid-template-columns: 1fr; gap: 14px; }
  .pick { position: relative; display: block; width: 100%; padding: 0; border: 0; background: #ddd6c8; border-radius: 16px; overflow: hidden; cursor: pointer; }
  .pick img { display: block; width: 100%; height: 260px; object-fit: cover; }
  .pick span { position: absolute; right: 0; bottom: 0; background: rgba(0,0,0,.45); color: #fff; font-size: 11px; padding: 3px 8px; border-top-left-radius: 6px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0 0; align-items: center; }
  button.b { font: inherit; font-size: 16px; padding: 11px 18px; border-radius: 999px; border: 1px solid #1f3a34; background: #1f3a34; color: #fff; cursor: pointer; }
  button.b.q { background: none; color: #1f3a34; }
  input { font: inherit; font-size: 16px; padding: 10px 14px; border-radius: 999px; border: 1px solid #b9b0a2; background: #fff; min-width: 220px; flex: 1; }
  .msg { margin-top: 14px; font-size: 15px; color: #6b6259; min-height: 22px; }
</style></head><body><div class="wrap">
  <div class="top"><div style="font-family: Georgia, serif; font-size: 22px">Voyage One covers</div><div class="count" id="count"></div></div>
  <h1 id="city"></h1>
  <div class="pair" id="pair"></div>
  <div class="row">
    <button class="b" id="more">Two more</button>
    <button class="b q" id="skip">Skip this place</button>
    <button class="b q" id="prev">Back one</button>
  </div>
  <div class="row"><input id="q" placeholder="Look for something else, e.g. Eiffel Tower at night"><button class="b q" id="go">Search</button></div>
  <div class="msg" id="msg"></div>
</div>
<script>
const K = new URLSearchParams(location.search).get("k") || "";
const CITIES = __CITIES__;
const HINTS = __HINTS__;   // words to try first for a place, where a photograph is already in mind
const key = (s) => String(s || "").replace(/\\s*\\([A-Z]{3}\\)\\s*$/, "").replace(/\\s+/g, " ").trim().toLowerCase();
const $ = (id) => document.getElementById(id);
let done = {}, at = 0, pool = [], shown = 0, skipped = {};
const text = (html) => { const d = document.createElement("div"); d.innerHTML = String(html || ""); return (d.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80); };

// Ask Commons for photographs. Wide ones only, large enough to fill the strip.
async function ask(words) {
  const u = "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=40&prop=imageinfo&iiprop=size|extmetadata|url|mime&iiurlwidth=1920&iiextmetadatafilter=LicenseShortName|Artist&format=json&origin=*&gsrsearch=" + encodeURIComponent(words + " filetype:bitmap");
  try {
    const j = await fetch(u).then((r) => r.json());
    return Object.values((j.query || {}).pages || {}).sort((a, b) => a.index - b.index).map((p) => {
      const i = (p.imageinfo || [])[0] || {}; const m = i.extmetadata || {};
      // A very wide panorama is short at 1920 across, so take Wikimedia's 3840 copy of it.
      let url = (i.thumburl || "").split("?")[0];
      if (i.width >= 3840 && i.width / i.height > 2.4) url = url.replace("/1920px-", "/3840px-");
      return { file: p.title, w: i.width, h: i.height, mime: i.mime, url, small: (i.thumburl || "").split("?")[0], page: i.descriptionurl || "", by: text((m.Artist || {}).value), lic: text((m.LicenseShortName || {}).value) };
    }).filter((x) => x.url && x.mime === "image/jpeg" && x.w >= 2000 && x.w / x.h >= 1.3 && !/public domain/i.test(x.lic));   // "Public domain" on Commons is mostly old paintings and century-old photographs
  } catch (e) { return []; }
}
// The best photographs first: Commons' featured pictures, then its quality images, then the rest.
async function gather(words) {
  const sets = await Promise.all([
    ask(words + " panorama incategory:Featured_pictures_on_Wikimedia_Commons"),
    ask(words + " incategory:Featured_pictures_on_Wikimedia_Commons"),
    ask(words + " incategory:Quality_images"),
    ask(words),
  ]);
  const seen = {}, out = [];
  sets.forEach((s) => s.forEach((x) => { if (!seen[x.file]) { seen[x.file] = 1; out.push(x); } }));
  return out;
}
function count() { $("count").textContent = Object.keys(done).length + " of " + CITIES.length + " chosen"; }
function show() {
  const two = pool.slice(shown, shown + 2); const box = $("pair"); box.innerHTML = "";
  if (!two.length) { $("msg").textContent = shown ? "No more for these words. Try the search box, or skip." : "Nothing found for this place. Try the search box, or skip."; return; }
  $("msg").textContent = "";
  two.forEach((x) => {
    const b = document.createElement("button"); b.className = "pick";
    const im = document.createElement("img"); im.src = x.small; im.alt = "";
    const c = document.createElement("span"); c.textContent = (x.by || "Wikimedia Commons") + (x.lic ? " \\u00b7 " + x.lic : "");
    b.appendChild(im); b.appendChild(c); b.onclick = () => choose(x); box.appendChild(b);
  });
}
async function load(words) {
  $("pair").innerHTML = ""; $("msg").textContent = "Looking\\u2026"; pool = await gather(words); shown = 0; show();
}
function open(i) {
  at = i;
  if (at >= CITIES.length) { $("city").textContent = "All done"; $("pair").innerHTML = ""; $("msg").textContent = "Every place has a cover, or was skipped. Reload the page to see the skipped ones again."; return; }
  $("city").textContent = CITIES[at] + (done[key(CITIES[at])] ? " (already chosen)" : ""); $("q").value = ""; load(HINTS[key(CITIES[at])] || CITIES[at]);
}
function next(from) { let i = from; while (i < CITIES.length && (done[key(CITIES[i])] || skipped[i])) i++; open(i); }
async function choose(x) {
  const city = CITIES[at]; $("msg").textContent = "Saving\\u2026";
  try {
    const j = await fetch("/api/covers?k=" + encodeURIComponent(K), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city, file: x.file, url: x.url, by: x.by, lic: x.lic, page: x.page }) }).then((r) => r.json());
    if (!j.ok) { $("msg").textContent = "Not saved: " + (j.reason || "unknown") + " Tap it again."; return; }
    done[key(city)] = 1; count(); next(at + 1);
  } catch (e) { $("msg").textContent = "Not saved (no connection). Tap it again."; }
}
$("more").onclick = () => { shown += 2; show(); };
$("skip").onclick = () => { skipped[at] = 1; next(at + 1); };
$("prev").onclick = () => { if (at > 0) open(at - 1); };
$("go").onclick = () => { const v = $("q").value.trim(); if (v) load(v); };
$("q").onkeydown = (e) => { if (e.key === "Enter") $("go").onclick(); };
(async () => {
  try { const j = await fetch("/api/covers?done=1&k=" + encodeURIComponent(K)).then((r) => r.json()); (j.done || []).forEach((d) => { done[d.city_key] = 1; }); } catch (e) {}
  count(); next(0);
})();
</script></body></html>`;
