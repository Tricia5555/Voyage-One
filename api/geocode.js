// Voyage One — coordinates for any city on earth.
//
// The map used to only plot cities I had typed coordinates for by hand, so Ho Chi Minh City
// or Birmingham AL simply vanished from the journey. This asks Google Places — already
// enabled for hotels and photos, so no new API — for the location of any place named.

export default async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_KEY;
  const city = (req.query.city || "").toString().trim();
  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  if (!city) return res.status(200).json({ ok: false, reason: "no-city" });

  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.location,places.displayName",
      },
      body: JSON.stringify({ textQuery: city, maxResultCount: 1 }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "places-error", status: r.status, detail: detail.slice(0, 200) });
    }
    const data = await r.json();
    const p = (data.places || [])[0];
    if (!p || !p.location) return res.status(200).json({ ok: true, city, lat: null, lng: null, note: "not-found" });

    res.setHeader("Cache-Control", "s-maxage=2592000, stale-while-revalidate=31536000");
    return res.status(200).json({
      ok: true,
      city,
      name: (p.displayName && p.displayName.text) || city,
      lat: p.location.latitude,
      lng: p.location.longitude,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
