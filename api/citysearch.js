// Voyage One — city suggestions as you type.
//
// Proxies Duffel's place search so the traveller picks a real place rather than hoping the
// spelling matches. Typing "Birmingham" offers both Birmingham, United Kingdom (BHX) and
// Birmingham, United States (BHM) — you choose, and the trip is built on a definite airport.

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
  const q = (req.query.q || "").toString().trim();
  if (!token) return res.status(200).json({ ok: false, reason: "no-token" });
  if (q.length < 2) return res.status(200).json({ ok: true, results: [] });

  try {
    const r = await fetch(`https://api.duffel.com/places/suggestions?query=${encodeURIComponent(q)}`, {
      headers: { "Accept": "application/json", "Duffel-Version": "v2", "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "duffel-error", status: r.status, detail: detail.slice(0, 200) });
    }
    const data = await r.json();
    const places = (data.data || []).filter((p) => p.iata_code);

    // A city covers all its airports, so it is the better pick when both appear. Keep single
    // airports too, for places whose city has no entry of its own.
    const cities = places.filter((p) => p.type === "city");
    const cityNames = new Set(cities.map((c) => (c.name || "").toLowerCase()));
    const airports = places.filter((p) => p.type === "airport" && !cityNames.has((p.city_name || "").toLowerCase()));

    const shape = (p) => ({
      code: p.iata_code,
      city: p.type === "city" ? p.name : (p.city_name || p.name),
      airport: p.type === "airport" ? p.name : null,
      country: COUNTRY[p.iata_country_code] || p.iata_country_code || "",
      countryCode: p.iata_country_code || "",
      type: p.type,
    });

    const results = [...cities.map(shape), ...airports.map(shape)].slice(0, 8);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
