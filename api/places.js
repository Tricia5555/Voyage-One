// Voyage One — real places, from Google.
//
// This runs on Vercel's servers, never in the browser. That is the whole point:
// GOOGLE_PLACES_KEY lives here and is never sent to a user. If this file ever ends up
// in the front end, the key leaks and anyone can spend Tricia's money.
//
// Returns real names, real photos, real editorial descriptions, real ratings, and Google's
// real price BAND ($ to $$$$). It does NOT invent a nightly rate — Google does not sell
// those, so we show the honest band and say "rates on request" until a booking API
// (Travelpayouts / Booking.com) is connected to supply true prices and availability.

const PRICE_TIER = {
  PRICE_LEVEL_VERY_EXPENSIVE: { band: "$$$$", note: "Top of the market" },
  PRICE_LEVEL_EXPENSIVE: { band: "$$$", note: "Upper tier" },
  PRICE_LEVEL_MODERATE: { band: "$$", note: "Mid-range" },
  PRICE_LEVEL_INEXPENSIVE: { band: "$", note: "Value" },
  PRICE_LEVEL_FREE: { band: "$", note: "Value" },
};



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
    const places = (data.places || []).filter((p) => p.displayName && p.displayName.text);

    // UltraLux is a GLOBAL standard — Villa d'Este, San Pietro — not "priciest in town".
    // So we tier on absolute class, never on local rank. A very good hotel in a second-tier
    // city lands in Luxury or Refined, and that is correct. UltraLux may come back empty,
    // and an empty UltraLux is the honest answer for a city that has no such property.
    //
    // Google's price levels are coarse and often blank, so:
    //   VERY_EXPENSIVE + strong reviews  → UltraLux   (the only road to the top tier)
    //   VERY_EXPENSIVE                   → Luxury
    //   EXPENSIVE                        → Luxury / Refined by rating
    //   MODERATE                         → Refined
    //   INEXPENSIVE / FREE / unknown     → Refined / Essential by rating
    // A hotel can NEVER reach UltraLux without an explicit very-expensive signal from Google.
    function classify(p) {
      const pl = p.priceLevel;
      const rating = p.rating || 0;
      const reviews = p.userRatingCount || 0;
      const acclaimed = rating >= 4.6 && reviews >= 150;
      if (pl === "PRICE_LEVEL_VERY_EXPENSIVE") return acclaimed ? "UltraLux" : "Luxury";
      if (pl === "PRICE_LEVEL_EXPENSIVE") return rating >= 4.5 ? "Luxury" : "Refined";
      if (pl === "PRICE_LEVEL_MODERATE") return "Refined";
      if (pl === "PRICE_LEVEL_INEXPENSIVE" || pl === "PRICE_LEVEL_FREE") return "Essential";
      // No price signal from Google: rating decides, but the top tier stays locked.
      if (rating >= 4.6 && reviews >= 300) return "Luxury";
      if (rating >= 4.3) return "Refined";
      return "Essential";
    }

    const grouped = { UltraLux: [], Luxury: [], Refined: [], Essential: [] };
    places.forEach((p) => {
      const level = classify(p);
      const photo = p.photos && p.photos[0] ? p.photos[0].name : null;
      grouped[level].push({
        id: p.id,
        name: p.displayName.text,
        level,
        band: p.priceLevel && PRICE_TIER[p.priceLevel] ? PRICE_TIER[p.priceLevel].band : null,
        bandNote: p.priceLevel && PRICE_TIER[p.priceLevel] ? PRICE_TIER[p.priceLevel].note : null,
        desc: (p.editorialSummary && p.editorialSummary.text) || "",
        rating: p.rating || null,
        reviews: p.userRatingCount || null,
        photo: photo ? `/api/photo?name=${encodeURIComponent(photo)}&h=420` : null,
        site: p.websiteUri || null,
        maps: p.googleMapsUri || null,
      });
    });
    // Best-reviewed first within each tier; a curated shortlist, not the whole list.
    for (const k of Object.keys(grouped)) {
      grouped[k].sort((a, b) => (b.rating || 0) - (a.rating || 0));
      grouped[k] = grouped[k].slice(0, 6);
    }

    // Google's terms require attribution wherever this is shown, and forbid holding
    // most of it for more than 30 days. An hour at the edge is well inside that.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ ok: true, city, kind, items: grouped, attribution: "Powered by Google" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
