// Voyage One — a real, recognizable photo for a destination, from Google Places.
//
// Replaces the old random-image service (loremflickr) that returned off-topic junk
// (a random photo merely tagged "Paris"). This asks Google for the city's most
// prominent place and returns its photo — so Paris looks like Paris.
//
// Uses the same GOOGLE_PLACES_KEY and the same photo proxy pattern as hotels.

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
        "X-Goog-FieldMask": "places.photos,places.displayName,places.types",
      },
      body: JSON.stringify({ textQuery: `${city} famous landmark`, maxResultCount: 5 }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "places-error", status: r.status, detail: detail.slice(0, 200) });
    }
    const data = await r.json();
    const places = data.places || [];
    let photoName = null;
    for (const p of places) {
      if (p.photos && p.photos[0] && p.photos[0].name) { photoName = p.photos[0].name; break; }
    }
    if (!photoName) return res.status(200).json({ ok: true, city, url: null, note: "no-photo" });

    // Keep the slashes in the photo name literal — the proxy validates places/ID/photos/ID
    // exactly. Encoding them as %2F makes the proxy reject it and the image comes back blank.
    const url = `/api/photo?name=${photoName}&h=600`;
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=2592000");
    return res.status(200).json({ ok: true, city, url });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
