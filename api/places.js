// Voyage One — real places, from Google.
//
// This runs on Vercel's servers, never in the browser. That is the whole point:
// GOOGLE_PLACES_KEY lives here and is never sent to a user. If this file ever ends up
// in the front end, the key leaks and anyone can spend Tricia's money.
//
// Returns real names, real photos, real editorial descriptions and real ratings.
// It does NOT return real nightly rates — Google does not sell those. Prices are marked
// indicative and must stay marked until a booking API replaces them.

const LEVEL_BY_PRICE = {
  PRICE_LEVEL_VERY_EXPENSIVE: "UltraLux",
  PRICE_LEVEL_EXPENSIVE: "Luxury",
  PRICE_LEVEL_MODERATE: "Refined",
  PRICE_LEVEL_INEXPENSIVE: "Essential",
  PRICE_LEVEL_FREE: "Essential",
};

// Indicative nightly rates by tier. Deliberately coarse — these are placeholders with a
// label, not a quote. Seeded off the place id so a hotel shows the same figure every time.
const BANDS = {
  hotels: { UltraLux: [700, 1600], Luxury: [380, 700], Refined: [200, 380], Essential: [110, 200] },
  restaurants: { UltraLux: [160, 280], Luxury: [90, 160], Refined: [50, 90], Essential: [28, 50] },
};

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function indicative(kind, level, id) {
  const band = (BANDS[kind] || BANDS.hotels)[level] || [200, 400];
  const t = (hash(id) % 1000) / 1000;
  return Math.round((band[0] + t * (band[1] - band[0])) / 5) * 5;
}

// Rating and review count together are a better tier signal than price level alone,
// which Google leaves blank surprisingly often.
function inferLevel(p, kind) {
  if (p.priceLevel && LEVEL_BY_PRICE[p.priceLevel]) return LEVEL_BY_PRICE[p.priceLevel];
  const r = p.rating || 0;
  const n = p.userRatingCount || 0;
  if (r >= 4.7 && n > 300) return "Luxury";
  if (r >= 4.4) return "Refined";
  return "Essential";
}

export default async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_KEY;
  const city = (req.query.city || "").toString().trim();
  const kind = (req.query.kind || "hotels").toString();

  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  if (!city) return res.status(200).json({ ok: false, reason: "no-city" });
  if (!["hotels", "restaurants"].includes(kind)) return res.status(200).json({ ok: false, reason: "bad-kind" });

  const query = kind === "hotels" ? `best hotels in ${city}` : `best restaurants in ${city}`;

  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.rating",
          "places.userRatingCount",
          "places.priceLevel",
          "places.editorialSummary",
          "places.photos",
          "places.websiteUri",
          "places.googleMapsUri",
        ].join(","),
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 20 }),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "google-error", status: r.status, detail: detail.slice(0, 300) });
    }

    const data = await r.json();
    const places = data.places || [];

    const grouped = { UltraLux: [], Luxury: [], Refined: [], Essential: [] };
    for (const p of places) {
      const name = p.displayName && p.displayName.text;
      if (!name) continue;
      const level = inferLevel(p, kind);
      const photo = p.photos && p.photos[0] ? p.photos[0].name : null;
      grouped[level].push({
        id: p.id,
        name,
        level,
        price: indicative(kind, level, p.id || name),
        // Google's own one-liner. If it has none, we say nothing rather than invent one.
        desc: (p.editorialSummary && p.editorialSummary.text) || "",
        rating: p.rating || null,
        reviews: p.userRatingCount || null,
        photo: photo ? `/api/photo?name=${encodeURIComponent(photo)}&h=420` : null,
        site: p.websiteUri || null,
        maps: p.googleMapsUri || null,
      });
    }

    // Best first within each tier, and keep it to a shortlist — this is an atelier, not a list.
    for (const k of Object.keys(grouped)) {
      grouped[k].sort((a, b) => (b.rating || 0) - (a.rating || 0));
      grouped[k] = grouped[k].slice(0, 5);
    }

    // Google's terms require attribution wherever this is shown, and forbid holding
    // most of it for more than 30 days. An hour at the edge is well inside that.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ ok: true, city, kind, items: grouped, attribution: "Powered by Google" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
