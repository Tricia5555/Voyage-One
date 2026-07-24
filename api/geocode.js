// Voyage One — coordinates for any city on earth.
//
// The map used to only plot cities I had typed coordinates for by hand, so Ho Chi Minh City
// or Birmingham AL simply vanished from the journey. This asks Google Places — already
// enabled for hotels and photos, so no new API — for the location of any place named.

export default async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_KEY;
  const raw = (req.query.city || "").toString().trim();
  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  if (!raw) return res.status(200).json({ ok: false, reason: "no-city" });

  // "Birmingham (BHM)" and "Birmingham (BHX)" are different places. When a code came with
  // the name, search on the airport itself so the right one is found — asking Google for
  // plain "Birmingham" reliably returns England and quietly ruins the rest of the trip.
  const codeMatch = /\(([A-Z]{3})\)\s*$/.exec(raw);
  const bare = raw.replace(/\s*\([A-Z]{3}\)\s*$/, "").trim();
  const query = codeMatch ? `${codeMatch[1]} airport ${bare}` : bare;

  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.location,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "places-error", status: r.status, detail: detail.slice(0, 200) });
    }
    const data = await r.json();
    const p = (data.places || [])[0];
    if (!p || !p.location) return res.status(200).json({ ok: true, city: raw, lat: null, lng: null, note: "not-found" });

    res.setHeader("Cache-Control", "s-maxage=2592000, stale-while-revalidate=31536000");
    return res.status(200).json({
      ok: true,
      city: raw,
      name: (p.displayName && p.displayName.text) || bare,
      where: p.formattedAddress || "",
      lat: p.location.latitude,
      lng: p.location.longitude,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
