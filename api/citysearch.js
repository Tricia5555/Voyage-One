// Voyage One — city suggestions as you type, town-first.
//
// A row in this list has to answer four things before anything downstream can work:
//   the town, the state or region, the country, and where on earth it actually is.
// The airport code is a fifth, attached only when we can prove it belongs.
//
// Coordinates are not decoration. ground.js routes on them, nearestair measures from them,
// and isLongHaul decides on them. A row without coordinates pushes all of that back onto a
// bare name, which is how "Birmingham" became a sixteen-hour drive from Milan and how
// Providence ended up in Virginia. So the list is not built until every row has them.
//
// Two Google calls, in sequence:
//
//   1. AUTOCOMPLETE, restricted to settlements. This replaces text search, which is a search
//      engine rather than a place picker: asked for "Providence" it answered with Providence
//      Recreation Center in Fairfax County, a building offering itself as a destination.
//      Autocomplete takes a type restriction and returns real places, each with a placeId —
//      an identity rather than a name, which is the thing a name can never be.
//
//   2. PLACE DETAILS on each placeId, for coordinates and address components. Six calls on a
//      search, cached for a day at the edge. Worth it: the coordinates are for the exact place
//      chosen, not for whatever a geocoder later makes of the words.
//
// Duffel is then used only to attach an airport code, and only where the coordinates agree.
// That test is the whole defence against the original bug: Google returned Birmingham,
// England, Duffel returned BHM, the names matched, and the picker offered "Birmingham, UK"
// carrying Alabama's airport code — while Alabama itself was dropped as a duplicate. Anything
// reading the label went to England, anything reading the code went to Alabama, and both were
// obeying what they were given.

const COUNTRY = {
  US: "United States", GB: "United Kingdom", FR: "France", IT: "Italy", ES: "Spain",
  DE: "Germany", PT: "Portugal", NL: "Netherlands", CH: "Switzerland", AT: "Austria",
  GR: "Greece", IE: "Ireland", BE: "Belgium", CZ: "Czechia", HU: "Hungary", PL: "Poland",
  SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", IS: "Iceland", HR: "Croatia",
  TR: "Turkey", MA: "Morocco", EG: "Egypt", ZA: "South Africa", AE: "UAE", QA: "Qatar",
  JP: "Japan", CN: "China", HK: "Hong Kong", SG: "Singapore", TH: "Thailand", ID: "Indonesia",
  IN: "India", AU: "Australia", NZ: "New Zealand", CA: "Canada", MX: "Mexico", BR: "Brazil",
  AR: "Argentina", CL: "Chile", PE: "Peru", CR: "Costa Rica", VN: "Vietnam", KR: "South Korea",
  MC: "Monaco", MT: "Malta", CY: "Cyprus", LU: "Luxembourg", SI: "Slovenia", EE: "Estonia",
  MZ: "Mozambique", TZ: "Tanzania", KE: "Kenya", MV: "Maldives", FJ: "Fiji", PF: "French Polynesia",
};

// The kinds of place worth flying to. "locality" is a town or city; the administrative levels
// and sublocalities catch comuni, quarters and the smaller places this app exists for —
// Positano is a comune, Monte Carlo a quarter. No establishments, so no recreation centres.
const PLACE_TYPES = [
  "locality", "administrative_area_level_1", "administrative_area_level_2",
  "administrative_area_level_3", "sublocality", "neighborhood",
];

// How many predictions to resolve. Each costs a details call, so this is the cost dial.
// Six is enough for three same-named towns plus their neighbours.
const RESOLVE_LIMIT = 6;

// Straight-line km — enough to tell "the same town" from "the same name, another country".
function km(a, b) {
  if (!a || !b || a[0] == null || b[0] == null) return null;
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function comp(components, type) {
  return (components || []).find((c) => (c.types || []).includes(type)) || null;
}

async function details(placeId, gKey) {
  try {
    const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": gKey,
        // Deliberately narrow. Location and address components are all this needs, and a
        // smaller mask is a cheaper call.
        "X-Goog-FieldMask": "id,displayName,location,addressComponents",
      },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  const token = process.env.DUFFEL_TOKEN;
  const gKey = process.env.GOOGLE_PLACES_KEY;
  const q = (req.query.q || "").toString().trim();
  if (q.length < 2) return res.status(200).json({ ok: true, results: [] });

  const results = [];
  const seen = new Set();
  // Keyed by name AND region AND country, so two Providences stay two rows. Country alone is
  // not enough: in the United States the repeats are usually within one country.
  const add = (r) => {
    const k = (r.city + "|" + (r.region || "") + "|" + (r.countryCode || "")).toLowerCase();
    if (!seen.has(k)) { seen.add(k); results.push(r); }
  };

  // 1) PRIMARY: Google — every settlement, airport or not, with region and coordinates.
  if (gKey) {
    try {
      const gr = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": gKey },
        body: JSON.stringify({ input: q, includedPrimaryTypes: PLACE_TYPES }),
      });
      if (gr.ok) {
        const gd = await gr.json();
        const ids = (gd.suggestions || [])
          .map((s) => s.placePrediction && s.placePrediction.placeId)
          .filter(Boolean)
          .slice(0, RESOLVE_LIMIT);
        // In parallel — six sequential round trips would be felt while typing.
        const full = await Promise.all(ids.map((id) => details(id, gKey)));
        full.forEach((d) => {
          if (!d) return;
          const nm = (d.displayName && d.displayName.text) || "";
          const loc = d.location || {};
          if (!nm || loc.latitude == null || loc.longitude == null) return;   // no coordinates, no row
          const ac = d.addressComponents;
          const cc = comp(ac, "country");
          const countryCode = cc && cc.shortText ? cc.shortText.toUpperCase() : "";
          const country = COUNTRY[countryCode] || (cc && cc.longText) || "";
          // Short form where there is one (RI, CA, NY), otherwise the full name — which is
          // what serves Campania, Provence and everywhere that does not abbreviate.
          const rc = comp(ac, "administrative_area_level_1");
          const region = rc ? (rc.shortText || rc.longText || "") : "";
          add({ code: null, city: nm, airport: null, country, countryCode, region,
                type: "place", placeId: d.id || null, lat: loc.latitude, lng: loc.longitude });
        });
      }
    } catch (e) { /* fall through to Duffel */ }
  }

  // 2) Duffel — attach airport codes to matching towns, and cover the case where Google gave nothing.
  if (token) {
    try {
      const r = await fetch(`https://api.duffel.com/places/suggestions?query=${encodeURIComponent(q)}`, {
        headers: { "Accept": "application/json", "Duffel-Version": "v2", "Authorization": `Bearer ${token}` },
      });
      if (r.ok) {
        const data = await r.json();
        (data.data || []).filter((p) => p.iata_code).forEach((p) => {
          const city = p.type === "city" ? p.name : (p.city_name || p.name);
          const dcc = (p.iata_country_code || "").toUpperCase();
          const country = COUNTRY[dcc] || dcc || "";
          const dpos = p.latitude != null && p.longitude != null ? [p.latitude, p.longitude] : null;

          const named = results.filter((x) => x.city.toLowerCase() === (city || "").toLowerCase());

          // The strong test: which of these towns is the airport actually near? An airport is
          // rarely more than 150 km from the town it serves, and two towns of one name are
          // almost never that close together. This is what separates Providence RI from
          // Providence VA, and Birmingham AL from Birmingham, England — a country check could
          // not do the first, and a name check got the second catastrophically wrong.
          let match = null;
          if (dpos) {
            let best = null, bestD = Infinity;
            named.forEach((x) => {
              const d = km([x.lat, x.lng], dpos);
              if (d != null && d < bestD) { best = x; bestD = d; }
            });
            if (best && bestD <= 150) match = best;
          } else {
            // No coordinates from Duffel. Fall back to country, but only when it is decisive.
            const sameCountry = named.filter((x) => x.countryCode && dcc && x.countryCode === dcc);
            if (sameCountry.length === 1) match = sameCountry[0];
          }

          if (match) { if (!match.code) match.code = p.iata_code; }
          else if (!named.length) {
            // Google never returned this place at all. Offer it in its own right, so an airport
            // town Google does not rank still reaches the list. No region — Duffel has none —
            // but it carries its own coordinates, which is the part that matters downstream.
            add({ code: p.iata_code, city, airport: p.type === "airport" ? p.name : null, country,
                  countryCode: dcc, region: "", type: p.type, placeId: null,
                  lat: dpos ? dpos[0] : null, lng: dpos ? dpos[1] : null });
          }
          // Otherwise: named towns exist but none is near this airport. Leave them uncoded.
          // A missing code is recoverable; a code on the wrong town is the Birmingham bug.
        });
      }
    } catch (e) { /* Google results still stand */ }
  }

  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  // Ten rather than eight: with ambiguous names the list now legitimately holds two or three
  // real places of one name, and the one you wanted should not fall off the end.
  return res.status(200).json({ ok: true, results: results.slice(0, 10) });
}
