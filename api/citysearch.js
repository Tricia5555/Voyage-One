// Voyage One — city suggestions as you type, town-first.
//
// The old version only offered places that had their own airport, so Monte Carlo, Cap
// d'Antibes, Positano, Portofino — the very places a luxury traveller wants to STAY — never
// appeared, because they have no airport. That is backwards for this app. Here Google Places
// is the primary source (it knows every town on earth), and Duffel is used only to attach an
// airport code when the place happens to have one. Everywhere real is selectable; the trip's
// flights route from the nearest airport, resolved separately.
//
// The codes and the names have to refer to the SAME PLACE. They used to be married on name
// alone: Google returned Birmingham, England, Duffel returned BHM, the names matched, and the
// picker offered "Birmingham, UK" carrying Alabama's airport code — while Alabama itself was
// dropped as a duplicate. Anything reading the label went to England, anything reading the
// code went to Alabama, and both were obeying what they were given. So a code is now attached
// only when the country agrees, and a place we cannot reconcile is offered as its own row
// rather than folded into a city on another continent.

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

// Straight-line km — enough to tell "the same town" from "the same name, another country".
function km(a, b) {
  if (!a || !b || a[0] == null || b[0] == null) return null;
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default async function handler(req, res) {
  const token = process.env.DUFFEL_TOKEN;
  const gKey = process.env.GOOGLE_PLACES_KEY;
  const q = (req.query.q || "").toString().trim();
  if (q.length < 2) return res.status(200).json({ ok: true, results: [] });

  const results = [];
  const seen = new Set();
  // Keyed by name AND country, so two cities sharing a name stay two entries.
  const add = (r) => {
    const k = (r.city + "|" + (r.countryCode || r.country || "")).toLowerCase();
    if (!seen.has(k)) { seen.add(k); results.push(r); }
  };

  // 1) PRIMARY: Google Places — every town, village and neighbourhood, airport or not.
  if (gKey) {
    try {
      const gr = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": gKey,
          // addressComponents gives us the ISO country code directly. Reading it off the end
          // of formattedAddress gave "USA" here and "United States" there, which is no basis
          // for deciding whether two results are the same country.
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.addressComponents,places.types,places.location",
        },
        body: JSON.stringify({ textQuery: q, maxResultCount: 8 }),
      });
      if (gr.ok) {
        const gd = await gr.json();
        (gd.places || []).forEach((gp) => {
          const nm = (gp.displayName && gp.displayName.text) || "";
          const types = gp.types || [];
          const isPlace = types.some((t) => ["locality", "sublocality", "administrative_area_level_1", "administrative_area_level_2", "administrative_area_level_3", "political", "neighborhood", "colloquial_area", "tourist_attraction"].includes(t));
          if (!nm || !isPlace) return;
          const addr = gp.formattedAddress || "";
          const cc = (gp.addressComponents || []).find((c) => (c.types || []).includes("country"));
          const countryCode = cc && cc.shortText ? cc.shortText.toUpperCase() : "";
          const country = COUNTRY[countryCode] || (cc && cc.longText) || addr.split(",").pop().trim();
          add({ code: null, city: nm, airport: null, country, countryCode, type: "place",
                lat: gp.location ? gp.location.latitude : null, lng: gp.location ? gp.location.longitude : null });
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

          // Same name is NOT the same place. Attach the code only if we can show they agree:
          // the country codes match, or (when a country is missing) the two sit within 150 km
          // of each other. An airport is rarely further than that from the town it serves.
          const candidates = results.filter((x) => x.city.toLowerCase() === (city || "").toLowerCase());
          const match = candidates.find((x) => {
            if (x.countryCode && dcc) return x.countryCode === dcc;
            const d = km([x.lat, x.lng], dpos);
            return d != null && d <= 150;
          });

          if (match) { if (!match.code) match.code = p.iata_code; }
          else {
            // Either Google never returned this place, or it returned one somewhere else with
            // the same name. Offer it in its own right — that is how both Birminghams appear,
            // each carrying the airport that actually belongs to it.
            add({ code: p.iata_code, city, airport: p.type === "airport" ? p.name : null, country,
                  countryCode: dcc, type: p.type,
                  lat: dpos ? dpos[0] : null, lng: dpos ? dpos[1] : null });
          }
        });
      }
    } catch (e) { /* Google results still stand */ }
  }

  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  // Ten rather than eight: with ambiguous names the list now legitimately holds two or three
  // real places of the same name, and the one you wanted should not fall off the end.
  return res.status(200).json({ ok: true, results: results.slice(0, 10) });
}
