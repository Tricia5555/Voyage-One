// Voyage One — city suggestions as you type, town-first.
//
// The old version only offered places that had their own airport, so Monte Carlo, Cap
// d'Antibes, Positano, Portofino — the very places a luxury traveller wants to STAY — never
// appeared, because they have no airport. That is backwards for this app. Here Google Places
// is the primary source (it knows every town on earth), and Duffel is used only to attach an
// airport code when the place happens to have one. Everywhere real is selectable; the trip's
// flights route from the nearest airport, resolved separately.

const COUNTRY = {
  US: "United States", GB: "United Kingdom", FR: "France", IT: "Italy", ES: "Spain",
  DE: "Germany", PT: "Portugal", NL: "Netherlands", CH: "Switzerland", AT: "Austria",
  GR: "Greece", IE: "Ireland", BE: "Belgium", CZ: "Czechia", HU: "Hungary", PL: "Poland",
  SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", IS: "Iceland", HR: "Croatia",
  TR: "Turkey", MA: "Morocco", EG: "Egypt", ZA: "South Africa", AE: "UAE", QA: "Qatar",
  JP: "Japan", CN: "China", HK: "Hong Kong", SG: "Singapore", TH: "Thailand", ID: "Indonesia",
  IN: "India", AU: "Australia", NZ: "New Zealand", CA: "Canada", MX: "Mexico", BR: "Brazil",
  AR: "Argentina", CL: "Chile", PE: "Peru", CR: "Costa Rica", VN: "Vietnam", KR: "South Korea",
};

export default async function handler(req, res) {
  const token = process.env.DUFFEL_TOKEN;
  const gKey = process.env.GOOGLE_PLACES_KEY;
  const q = (req.query.q || "").toString().trim();
  if (q.length < 2) return res.status(200).json({ ok: true, results: [] });

  const results = [];
  const seen = new Set();
  const add = (r) => { const k = (r.city + "|" + (r.country || "")).toLowerCase(); if (!seen.has(k)) { seen.add(k); results.push(r); } };

  // 1) PRIMARY: Google Places — every town, village and neighbourhood, airport or not.
  if (gKey) {
    try {
      const gr = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": gKey, "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.types,places.location" },
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
          const country = addr.split(",").pop().trim();
          add({ code: null, city: nm, airport: null, country, countryCode: "", type: "place",
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
          const country = COUNTRY[p.iata_country_code] || p.iata_country_code || "";
          const existing = results.find((x) => x.city.toLowerCase() === (city || "").toLowerCase());
          if (existing) { if (!existing.code) existing.code = p.iata_code; }
          else add({ code: p.iata_code, city, airport: p.type === "airport" ? p.name : null, country, countryCode: p.iata_country_code || "", type: p.type });
        });
      }
    } catch (e) { /* Google results still stand */ }
  }

  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json({ ok: true, results: results.slice(0, 8) });
}
