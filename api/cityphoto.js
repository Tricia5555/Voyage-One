// Voyage One — a real, recognizable photo for a destination, from Google Places.
//
// Replaces the old random-image service (loremflickr) that returned off-topic junk
// (a random photo merely tagged "Paris"). This asks Google for the city's most
// prominent place and returns its photo — so Paris looks like Paris.
//
// Uses the same GOOGLE_PLACES_KEY and the same photo proxy pattern as hotels.

// GOOGLE'S CREDIT TRAVELS WITH THE PHOTO (12 Nov 2026). Places photos may be shown only with their
// author credited and a link to the photo on Google Maps. The credit rides on the photo's own
// address (by = the author's name, byu = their profile, gm = the photo on Google Maps), so every
// place the site shows the photo can show the credit beside it.
function photoUrl(ph, h) {
  if (!ph || !ph.name) return null;
  const a = (ph.authorAttributions || [])[0] || {};
  return `/api/photo?name=${encodeURIComponent(ph.name)}&h=${h}`
    + (a.displayName ? `&by=${encodeURIComponent(a.displayName)}` : "")
    + (a.uri ? `&byu=${encodeURIComponent(a.uri)}` : "")
    + (ph.googleMapsUri ? `&gm=${encodeURIComponent(ph.googleMapsUri)}` : "");
}

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
    let photo = null;
    for (const p of places) {
      if (p.photos && p.photos[0] && p.photos[0].name) { photo = p.photos[0]; break; }
    }
    if (!photo) return res.status(200).json({ ok: true, city, url: null, note: "no-photo" });

    // Build the proxy URL EXACTLY like the working hotel photos do (places.js): encode the
    // name. The server decodes it before the regex check, and encoding protects any special
    // characters in Google's long photo IDs. This mirrors the proven hotel path.
    const url = photoUrl(photo, 600);
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=2592000");
    return res.status(200).json({ ok: true, city, url });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
