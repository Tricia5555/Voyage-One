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

// The picker hands cities over as "Bermuda (BDA)" once a place has an airport code. Google
// copes with that, but "best hotels in Bermuda (BDA)" is a worse query than "best hotels in
// Bermuda", and a worse query drifts. Strip it before we ask.
function bareCity(s) { return (s || "").replace(/\s*\([A-Z]{3}\)\s*$/, "").trim(); }

// Google's editorial summaries use a remarkably consistent register, and it is the only
// signal in the data that speaks to CLASS rather than popularity. Rosewood is a "High-end
// beachfront resort"; Hamilton Princess is "Polished lodging"; a roadside chain is
// "Straightforward" or "Unpretentious". Ratings cannot tell those apart — a budget hotel
// that does its job well earns 4.6 just as easily as a grand resort.
const UPSCALE_WORDS = /\b(luxe|luxury|luxurious|high-end|upscale|upmarket|polished|refined|elegant|chic|ultrachic|sleek|stylish|opulent|grand|genteel|swanky|posh|exclusive|five-star|5-star)\b/i;
const MODEST_WORDS = /\b(straightforward|unpretentious|no-frills|budget|casual|modest|simple|basic|low-key|functional|value|economy)\b/i;

// No property from a budget or midscale chain belongs in the top tier, anywhere on earth,
// however well reviewed. This is a rule about brands, not about cities — it needs no
// per-destination maintenance and it travels.
const CAPPED_CHAINS = /\b(best western|holiday inn|express by holiday|comfort (inn|suites)|quality inn|days inn|super 8|motel 6|travelodge|ramada|howard johnson|la quinta|hampton inn|fairfield inn|courtyard by marriott|residence inn|springhill|towneplace|four points|red roof|econo lodge|rodeway|knights inn|americinn|country inn|drury inn|extended stay|candlewood|staybridge|home2|tru by hilton|premier inn|travelodge|ibis(?! styles)?|campanile|b&b hotel|formule ?1|jurys inn|travelstay)\b/i;

export default async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_KEY;
  const rawCity = (req.query.city || "").toString().trim();
  const city = bareCity(rawCity);
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
          "places.types",
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
    let places = (data.places || []).filter((p) => p.displayName && p.displayName.text);

    // "best hotels in X" pulls in restaurants with a few rooms — Fourways Restaurant & Inn
    // was sitting in Bermuda's Luxury hotels next to Cambridge Beaches. Keep anything Google
    // types as lodging, and drop anything it types purely as somewhere to eat. Places with no
    // types at all are kept: an unlabelled hotel is likelier than a mislabelled one.
    const typesOf = (p) => (p.types || []).map((x) => String(x).toLowerCase());
    const LODGING = /(lodging|hotel|resort|motel|inn|guest_house|bed_and_breakfast|cottage|campground)/;
    const EATING = /(restaurant|cafe|bar|bakery|meal_takeaway|meal_delivery|food)/;
    if (kind === "hotels") {
      places = places.filter((p) => {
        const t = typesOf(p);
        if (!t.length) return true;
        if (t.some((x) => LODGING.test(x))) return true;
        return !t.some((x) => EATING.test(x));
      });
    } else {
      places = places.filter((p) => {
        const t = typesOf(p);
        if (!t.length) return true;
        if (t.some((x) => EATING.test(x))) return true;
        return !t.some((x) => LODGING.test(x));
      });
    }

    // UltraLux is a GLOBAL standard — Villa d'Este, San Pietro — not "priciest in town".
    // So we tier on absolute class, never on local rank. A very good hotel in a second-tier
    // city lands in Luxury or Refined, and that is correct. UltraLux may come back empty,
    // and an empty UltraLux is the honest answer for a city that has no such property.
    //
    // Google gives us two weak signals and one good one:
    //   priceLevel        — coarse, and BLANK for entire countries (all of Bermuda has none)
    //   rating + reviews  — measures satisfaction, not class. A budget hotel that does its
    //                       job well scores 4.6 as easily as a grand resort does.
    //   editorialSummary  — Google's own register: "High-end", "Polished", "Upscale" versus
    //                       "Straightforward", "Unpretentious". This is the class signal.
    //
    // Approximate star class:
    //   VERY_EXPENSIVE                                  → 5-star → UltraLux
    //   EXPENSIVE + well reviewed                       → 5-star → UltraLux
    //   EXPENSIVE                                       → 4-star → Luxury
    //   MODERATE                                        → 3-star → Refined
    //   INEXPENSIVE / FREE                              → 2-star → Essential
    //   no band + acclaimed + upscale editorial wording → 5-star → UltraLux
    //   no band + acclaimed                             → 4-star → Luxury
    //   no band + strong rating                         → 4-star → Luxury
    //
    // The change from the previous version: reputation ALONE now tops out at four stars.
    // Reaching UltraLux needs a price signal or Google's own upscale language. Without that,
    // a well-liked chain hotel was climbing into the top tier — which is what put a Best
    // Western in front of a client looking at Bermuda.
    function starClass(p) {
      const pl = p.priceLevel;
      const rating = p.rating || 0;
      const reviews = p.userRatingCount || 0;
      const name = (p.displayName && p.displayName.text) || "";
      const blurb = (p.editorialSummary && p.editorialSummary.text) || "";
      const wellReviewed = rating >= 4.4 && reviews >= 150;
      const acclaimed = rating >= 4.6 && reviews >= 250;
      const upscale = UPSCALE_WORDS.test(blurb);
      const modest = MODEST_WORDS.test(blurb) && !upscale;

      // A budget or midscale chain is capped at Refined however it is described or reviewed.
      if (CAPPED_CHAINS.test(name)) return Math.min(3, pl === "PRICE_LEVEL_EXPENSIVE" ? 3 : 3);

      let stars;
      if (pl === "PRICE_LEVEL_VERY_EXPENSIVE") stars = 5;
      else if (pl === "PRICE_LEVEL_EXPENSIVE") stars = wellReviewed ? 5 : 4;
      else if (pl === "PRICE_LEVEL_MODERATE") stars = 3;
      else if (pl === "PRICE_LEVEL_INEXPENSIVE" || pl === "PRICE_LEVEL_FREE") stars = 2;
      else {
        // No band at all — the common case in smaller markets, and where the old logic went
        // wrong. Reputation gets you to four; Google's own wording is what earns the fifth.
        if (acclaimed && upscale) stars = 5;
        else if (acclaimed) stars = 4;
        else if (rating >= 4.4 && reviews >= 150) stars = 4;
        else if (rating >= 4.2) stars = 3;
        else stars = 2;
      }
      // Explicitly modest language pulls a property back down a step, whatever the band.
      if (modest && stars > 3) stars = 3;
      return stars;
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
    // Within a tier, order by how well regarded a place is, but let a property Google
    // actually describes as upscale sit above one it says nothing about at the same score.
    for (const k of Object.keys(grouped)) {
      grouped[k].sort((a, b) => {
        const au = UPSCALE_WORDS.test(a.desc || "") ? 1 : 0;
        const bu = UPSCALE_WORDS.test(b.desc || "") ? 1 : 0;
        if (au !== bu) return bu - au;
        return (b.rating || 0) - (a.rating || 0);
      });
      grouped[k] = grouped[k].slice(0, 10);
    }

    // Google's terms require attribution wherever this is shown, and forbid holding
    // most of it for more than 30 days. An hour at the edge is well inside that.
    //
    // Shortened from an hour: a wrong result used to sit pinned at the edge for up to a day
    // (stale-while-revalidate), which made bad tiering look intermittent and unreproducible.
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    return res.status(200).json({ ok: true, city, kind, items: grouped, attribution: "Powered by Google" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
