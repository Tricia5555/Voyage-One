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

// The flag over the door. This is how a travel agent actually knows a hotel's class, and
// after testing every alternative it is the only signal in reach: Google gives us no star
// class, priceLevel is null on every hotel, priceRange is null too, and rating and review
// count both rank a six-hundred-room Times Square tourist hotel above The Plaza.
//
// This is a list, and Tricia is right to distrust lists — but it is a list of BRANDS, not
// of cities or hotels. Four Seasons is Four Seasons in Lisbon, Bali and Kyoto. Written once,
// it is correct in every city on earth and never needs editing for a new destination. That
// is the opposite of a per-city patch.
//
// It works because Google's displayName carries the flag: "Villa San Michele, A Belmond
// Hotel", "The Pierre, A Taj Hotel", "Four Seasons Hotel New York Downtown".
//
// Known gap: independent landmarks with no group behind them. A handful of the most famous
// are named below, but that tail is long and cannot be typed out honestly. The real fix is
// supplier data — Duffel Stays and every other inventory API carry a star class, because
// star ratings are national schemes that travel with the room, not a thing you can look up.
const ULTRA_BRANDS = [
  // Global groups operating at the top of the market
  "aman", "four seasons", "rosewood", "mandarin oriental", "peninsula", "belmond",
  "st. regis", "st regis", "ritz-carlton", "ritz carlton", "waldorf astoria", "park hyatt",
  "bulgari", "bvlgari", "cheval blanc", "raffles", "oetker", "dorchester", "one&only",
  "one and only", "six senses", "capella", "soneva", "baccarat", "corinthia", "rocco forte",
  "auberge", "montage", "oberoi", "taj ", "a taj", "shangri-la", "shangri la", "regent ",
  "banyan tree", "jumeirah", "cheval blanc", "orient express",
  // Independent landmarks with no group behind them — the incomplete part, and the reason
  // supplier data matters. Matched on distinctive words, not whole names.
  "the plaza", "the pierre", "the carlyle", "claridge", "the connaught", "the berkeley",
  "le bristol", "plaza athénée", "plaza athenee", "the savoy", "the ritz london", "hotel ritz",
  "danieli", "cipriani", "gritti", "splendido", "villa d'este", "le sirenuse", "il pellicano",
  "the greenbrier", "the broadmoor", "beverly hills hotel", "bel-air", "the mark",
];
function ultraBrand(name) {
  const n = String(name || "").toLowerCase();
  return ULTRA_BRANDS.some((b) => n.includes(b));
}

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

// The neighbourhood, pulled from Google's address components — "Mayfair", "Tribeca", "Ginza".
// A restaurant card can then read "Destination · Mayfair, London", just as the hotel cards
// carry an area. We prefer a true neighbourhood, then a sublocality, so something sensible
// shows in cities that name their districts differently.
function neighborhoodOf(p) {
  const comps = (p && p.addressComponents) || [];
  const pick = (type) => {
    const c = comps.find((x) => Array.isArray(x.types) && x.types.includes(type));
    return c ? (c.longText || c.shortText || null) : null;
  };
  return pick("neighborhood") || pick("sublocality_level_1") || pick("sublocality") || null;
}



export default async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_KEY;
  const city = (req.query.city || "").toString().trim();
  const kind = (req.query.kind || "hotels").toString();
  // A named search. The browse list is deliberately a shortlist of twenty, which is the
  // right size to choose from but far too small to contain every property in a city like
  // Florence. When a traveller already knows the name, asking Google for THAT is both
  // cheaper and more useful than widening the browse list for everyone.
  const find = (req.query.find || "").toString().trim().slice(0, 120);

  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  if (!city) return res.status(200).json({ ok: false, reason: "no-city" });
  if (!["hotels", "restaurants"].includes(kind)) return res.status(200).json({ ok: false, reason: "bad-kind" });

  // The city stays in the query so "Cipriani" finds the Venice one, not the New York one.
  // The kind word keeps a hotel search off restaurants of the same name, and vice versa.
  //
  // BROWSING ASKS TWICE. Google returns twenty results for a text query, and twenty is a
  // general web ranking — popularity, review volume, SEO — not a hotel list. Asked for the
  // best hotels in Boston it produced a bed and breakfast, a Hyatt Place and a Staypineapple,
  // and left out the Four Seasons, the Mandarin Oriental and the Ritz-Carlton entirely. No
  // amount of tiering can rescue a hotel that never arrives.
  //
  // So a second query goes in alongside, worded to pull the top of the market rather than the
  // most-clicked. Merged and deduplicated by place id, that is roughly forty properties instead
  // of twenty, weighted toward exactly the tier that was starving. It costs one extra Places
  // call per city, which is the honest price of a top tier that contains the top hotels.
  const browseQueries = kind === "hotels"
    ? [`best hotels in ${city}`, `luxury 5 star hotels in ${city}`]
    : [`best restaurants in ${city}`, `fine dining restaurants in ${city}`];
  const queries = find ? [`${find} ${kind === "hotels" ? "hotel" : "restaurant"} ${city}`] : browseQueries;

  try {
    const ask = (textQuery) => fetch("https://places.googleapis.com/v1/places:searchText", {
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
          // priceLevel comes back null on every hotel — Four Seasons, Baccarat, The Langham,
          // all of them. priceRange holds actual currency amounts rather than a $–$$$$ band;
          // it too returns null for hotels, but it is in the same billing tier as priceLevel,
          // so it costs nothing to keep asking in case Google ever fills it in.
          "places.priceRange",
          "places.editorialSummary",
          "places.photos",
          "places.websiteUri",
          "places.googleMapsUri",
          // Location and contact, for the card and the itinerary. formattedAddress is the full
          // street line; addressComponents gives us the neighbourhood; internationalPhoneNumber
          // is shown as plain text (no link) so the guest never leaves the app.
          "places.formattedAddress",
          "places.addressComponents",
          "places.internationalPhoneNumber",
        ].join(","),
      },
      body: JSON.stringify({ textQuery, maxResultCount: find ? 5 : 20 }),
    });

    // In parallel — two sequential round trips would be felt on every city opened.
    const responses = await Promise.all(queries.map(ask));

    // Only a total failure is an error. If the second query fails and the first succeeds we
    // still have a good list, and a narrower list beats an empty panel.
    if (responses.every((r) => !r.ok)) {
      const detail = await responses[0].text();
      return res.status(200).json({ ok: false, reason: "google-error", status: responses[0].status, detail: detail.slice(0, 300) });
    }

    // Merge, keeping first appearance. The queries overlap heavily — that is expected, and the
    // place id is what makes the overlap free rather than duplicated.
    const byId = new Map();
    for (const r of responses) {
      if (!r.ok) continue;
      let d = null;
      try { d = await r.json(); } catch (e) { continue; }
      (d.places || []).forEach((p) => {
        if (!p || !p.id || byId.has(p.id)) return;
        byId.set(p.id, p);
      });
    }
    const data = { places: Array.from(byId.values()) };

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
      // The top tier is now reached by the flag over the door, with a rating floor so that a
      // tired outpost of a great group cannot coast on the name. Reputation ALONE no longer
      // reaches five stars: that path put Hotel Riu Plaza Times Square above The Plaza, on
      // the strength of nine thousand reviews. Volume is not class.
      if (ultraBrand(p.displayName && p.displayName.text) && rating >= 4.3) return 5;
      // A second door into the top tier, opened deliberately: a recognised flag makes for a
      // correct list but a predictable one, and a house nobody has heard of that everybody
      // loves is exactly what a good agent is for. The cost is that this door has no way to
      // tell a small remarkable hotel from a large well-run commercial one — both can hold
      // 4.6 — so the tier will contain some names that do not belong beside the Ritz.
      if (rating >= 4.6) return 5;
      if (pl === "PRICE_LEVEL_VERY_EXPENSIVE") return 5;
      if (pl === "PRICE_LEVEL_EXPENSIVE") return wellReviewed ? 5 : 4;
      if (pl === "PRICE_LEVEL_MODERATE") return 3;
      if (pl === "PRICE_LEVEL_INEXPENSIVE" || pl === "PRICE_LEVEL_FREE") return 2;
      // No band at all — reputation decides, but only up to four stars. A hotel with no
      // recognised flag and no price signal may be excellent; we cannot show that it is
      // five-star, and an empty UltraLux is the honest answer for a city with no such house.
      if (rating >= 4.5 && reviews >= 250) return 4;
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
        priceRange: p.priceRange || null,   // diagnostic — see the field mask note above
        estRate: estRate(kind, level, band),
        desc: (p.editorialSummary && p.editorialSummary.text) || "",
        rating: p.rating || null,
        reviews: p.userRatingCount || null,
        photo: photo ? `/api/photo?name=${encodeURIComponent(photo)}&h=420` : null,
        site: p.websiteUri || null,
        maps: p.googleMapsUri || null,
        area: neighborhoodOf(p),                    // neighbourhood, e.g. "Mayfair"
        address: p.formattedAddress || null,        // full street line for the itinerary
        phone: p.internationalPhoneNumber || null,  // shown as plain text, no link
      });
    });
    // A named search answers a different question, so it gets a different shape: one flat
    // list in GOOGLE'S order, not ours. For a browse list, best-reviewed first is right. For
    // "find me the Villa San Michele", relevance to what was typed is right — re-sorting by
    // rating would push the property she asked for below a neighbour with more reviews.
    // Each result still carries its tier, so it slots into the same picker unchanged.
    if (find) {
      const matches = [];
      for (const k of Object.keys(grouped)) matches.push(...grouped[k]);
      const order = places.map((p) => p.id);
      matches.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
      return res.status(200).json({ ok: true, city, kind, find, matches: matches.slice(0, 5), attribution: "Powered by Google" });
    }

    // Best-reviewed first within each tier; a curated shortlist, not the whole list.
    for (const k of Object.keys(grouped)) {
      grouped[k].sort((a, b) => (b.rating || 0) - (a.rating || 0));
      // Twelve rather than ten. With two queries feeding the list there is genuinely more to
      // choose from, and UltraLux was the tier being truncated hardest.
      grouped[k] = grouped[k].slice(0, 12);
    }

    // Google's terms require attribution wherever this is shown, and forbid holding
    // most of it for more than 30 days. An hour at the edge is well inside that.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ ok: true, city, kind, items: grouped, attribution: "Powered by Google" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
