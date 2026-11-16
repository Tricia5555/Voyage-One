// api/collect-ids.js — FILLS THE INVENTORY (M1067, 16 Nov 2026).
//
// For each restaurant on a list, asks Google one thing — "what is this place's ID?" — and saves
// the answer in the `place_ids` table. Asking for the ID alone is on Google's free list
// ("Text Search Essentials (IDs Only)"), and the ID is the one thing Google's terms allow a site
// to keep permanently. Nothing else from Google is stored.
//
// It asks in exactly the words the site uses today ("<name> restaurant <city>") and keeps the first
// answer, so each restaurant resolves to the same place its card shows now.
//
// ONLY ON THE STAGING COPY. It refuses to run on the live site, so a stranger cannot start it.
// Open:  https://staging.voyageoneworld.com/api/collect-ids?list=nyc-restaurants
// Safe to run again: it only fills in what is missing (add &redo=1 to ask again for everything).
import { LISTS } from "./_collect-list.js";

const SB = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SBK = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SBH = () => ({ apikey: SBK, Authorization: `Bearer ${SBK}`, "Content-Type": "application/json" });
const norm = (s) => String(s || "").trim().toLowerCase();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.VERCEL_ENV !== "preview") return res.status(403).json({ ok: false, reason: "This runs only on the staging copy." });
  const gkey = (process.env.GOOGLE_PLACES_KEY || "").trim();
  if (!gkey || !SB || !SBK) return res.status(200).json({ ok: false, reason: "not configured" });
  const list = LISTS[(req.query.list || "").toString()];
  if (!list) return res.status(200).json({ ok: false, reason: "unknown list", lists: Object.keys(LISTS) });
  const redo = req.query.redo === "1";
  const kindWord = list.kind === "hotels" ? "hotel" : list.kind === "restaurants" ? "restaurant" : "";

  // What is already in the inventory for this city.
  const have = {};
  try {
    const r = await fetch(`${SB}/rest/v1/place_ids?select=name_key,google_id&kind=eq.${list.kind}&city_key=eq.${encodeURIComponent(norm(list.city))}&limit=5000`, { headers: SBH() });
    if (!r.ok) return res.status(200).json({ ok: false, reason: "The place_ids table is not there yet. Run place-ids.sql in Supabase first.", status: r.status });
    (await r.json()).forEach((x) => { if (x.google_id) have[x.name_key] = x.google_id; });
  } catch (e) { return res.status(200).json({ ok: false, reason: "could not read the inventory" }); }

  const todo = list.names.filter((n) => redo || !have[norm(n)]);
  const found = [], missed = [], rows = [];
  const askOne = async (name) => {
    try {
      const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": gkey, "X-Goog-FieldMask": "places.id" },   // the ID and nothing else: the free request
        body: JSON.stringify({ textQuery: `${name} ${kindWord} ${list.city}`.replace(/\s+/g, " ").trim(), maxResultCount: 1, languageCode: "en" }),
      });
      const j = await r.json().catch(() => null);
      const id = r.ok && j && j.places && j.places[0] && j.places[0].id;
      if (!id) { missed.push({ name, why: r.ok ? "Google found nothing" : `Google answered ${r.status}` }); return; }
      found.push(name);
      rows.push({ kind: list.kind, city_key: norm(list.city), name_key: norm(name), city: list.city, name, google_id: id, updated_at: new Date().toISOString() });
    } catch (e) { missed.push({ name, why: "no answer" }); }
  };
  for (let i = 0; i < todo.length; i += 10) await Promise.all(todo.slice(i, i + 10).map(askOne));

  let saved = 0, saveError = null;
  if (rows.length) {
    const r = await fetch(`${SB}/rest/v1/place_ids?on_conflict=kind,city_key,name_key`, { method: "POST", headers: { ...SBH(), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    if (r.ok) saved = rows.length; else saveError = `${r.status} ${(await r.text()).slice(0, 200)}`;
  }
  return res.status(200).json({
    ok: !saveError, list: req.query.list, city: list.city, onTheList: list.names.length,
    alreadyHad: list.names.length - todo.length, askedGoogle: todo.length, found: found.length, saved,
    notFound: missed, saveError,
    note: saveError ? "Google answered, but saving failed." : `${Object.keys(have).length + saved} of ${list.names.length} now have an ID in the inventory.`,
  });
}
