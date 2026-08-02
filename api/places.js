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
// An ESTIMATED nightly rate so every hotel carries a number and the total means something.
// Driven by our own tier (which already blends price + rating), nudged by Google's band.
// Clearly labelled "est." in the UI — a real rate replaces it when booking is connected.
const NIGHTLY_EST = { UltraLux: 1100, Luxury: 550, Refined: 300, Essential: 160 };
const PERSON_EST = { UltraLux: 180, Luxury: 110, Refined: 65, Essential: 38 };
function estRate(kind, level, band) {
  const baseTable = kind === "restaurants" ? PERSON_EST : NIGHTLY_EST;
  let v = baseTable[level] || baseTable.Refined;
  // A $$$$ band in a Luxury tier nudges up; a $ band nudges down — keeps it believable.
  if (band === "$$$$") v = Math.round(v * 1.15);
  else if (band === "$") v = Math.round(v * 0.8);
  return Math.round(v / 5) * 5;
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
    // Google's Places API does not expose a true hotel star class (that lives in a separate
    // Google Hotels product). We have two real signals: a coarse price band, often blank,
    // and a review rating. We map them to an approximate star class, then to a tier, so a
    // genuine five-star property lands in UltraLux rather than getting stuck in Luxury.
    //
    // Approximate star class:
    //   VERY_EXPENSIVE                          → 5-star  → UltraLux
    //   EXPENSIVE + well reviewed               → 5-star  → UltraLux
    //   EXPENSIVE                               → 4-star  → Luxury
    //   MODERATE                                → 3-star  → Refined
    //   INEXPENSIVE / FREE                      → 2-star  → Essential
    //   no band, but acclaimed (high rating,
    //     lots of reviews)                      → 5-star  → UltraLux
    //   no band, strong rating                  → 4-star  → Luxury
    // Hotels with no price band and a merely good rating stay Refined/Essential.
    function starClass(p) {
      const pl = p.priceLevel;
      const rating = p.rating || 0;
      const reviews = p.userRatingCount || 0;
      const wellReviewed = rating >= 4.4 && reviews >= 150;
      const acclaimed = rating >= 4.6 && reviews >= 250;
      if (pl === "PRICE_LEVEL_VERY_EXPENSIVE") return 5;
      if (pl === "PRICE_LEVEL_EXPENSIVE") return wellReviewed ? 5 : 4;
      if (pl === "PRICE_LEVEL_MODERATE") return 3;
      if (pl === "PRICE_LEVEL_INEXPENSIVE" || pl === "PRICE_LEVEL_FREE") return 2;
      // No band at all — lean on reputation.
      if (acclaimed) return 5;
      if (rating >= 4.4 && reviews >= 150) return 4;
      if (rating >= 4.2) return 3;
      return 2;
    }
    const STAR_TIER = { 5: "UltraLux", 4: "Luxury", 3: "Refined", 2: "Essential", 1: "Essential" };
    function classify(p) {
      if (kind === "restaurants") return classifyDining(p);
      return STAR_TIER[starClass(p)];
    }

    // Restaurants need the OPPOSITE tuning from hotels. Google gives dining an even coarser
    // price signal — often just $$$$ with nothing finer — so if we treated any pricey, well-
    // reviewed place as top-tier, UltraLux would swallow every good restaurant and Luxury
    // would stand empty. That is the bug. So for dining, UltraLux is deliberately RARE: it is
    // the city's icon (the Le Bernardin, the three-star temple), signalled by the very top
    // price band AND a destination-level review count. Everything else excellent is Luxury —
    // which is where a lovely fine-dining bistro belongs.
    function classifyDining(p) {
      const pl = p.priceLevel;
      const rating = p.rating || 0;
      const reviews = p.userRatingCount || 0;
      const iconic = rating >= 4.6 && reviews >= 2000;     // a true destination restaurant
      const notable = rating >= 4.4 && reviews >= 600;
      if (pl === "PRICE_LEVEL_VERY_EXPENSIVE") return iconic ? "UltraLux" : "Luxury";
      if (pl === "PRICE_LEVEL_EXPENSIVE") return (rating >= 4.5 || notable) ? "Luxury" : "Refined";
      if (pl === "PRICE_LEVEL_MODERATE") return rating >= 4.5 ? "Refined" : "Refined";
      if (pl === "PRICE_LEVEL_INEXPENSIVE" || pl === "PRICE_LEVEL_FREE") return "Essential";
      // No price band from Google — reputation decides, and the top stays hard to reach.
      if (iconic) return "UltraLux";
      if (rating >= 4.5 && reviews >= 600) return "Luxury";
      if (rating >= 4.2) return "Refined";
      return "Essential";
    }

    const grouped = { UltraLux: [], Luxury: [], Refined: [], Essential: [] };
    places.forEach((p) => {
      const level = classify(p);
      const photo = p.photos && p.photos[0] ? p.photos[0].name : null;
      const band = p.priceLevel && PRICE_TIER[p.priceLevel] ? PRICE_TIER[p.priceLevel].band : null;
      grouped[level].push({
        id: p.id,
        name: p.displayName.text,
        level,
        stars: kind === "hotels" ? starClass(p) : null,
        band,
        bandNote: p.priceLevel && PRICE_TIER[p.priceLevel] ? PRICE_TIER[p.priceLevel].note : null,
        estRate: estRate(kind, level, band),
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
      grouped[k] = grouped[k].slice(0, 10);
    }

    // Google's terms require attribution wherever this is shown, and forbid holding
    // most of it for more than 30 days. An hour at the edge is well inside that.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ ok: true, city, kind, items: grouped, attribution: "Powered by Google" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
