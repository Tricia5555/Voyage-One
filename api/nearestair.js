// Voyage One — the nearest real airport to anywhere.
//
// Some places have no airport of their own — Positano, a lakeside village, a hill town. A
// good travel agent knows you fly to the nearest airport that actually has service and then
// go overland. This computes that for ANY place, from coordinates and live airport data, so
// there is no hand-kept list of "gateways" to maintain. Positano is not special; it is just
// a place whose nearest airport is Naples, and the same logic finds the gateway for anywhere.
//
// Given a place's coordinates, we ask Duffel for airports near it (Place Suggestions with a
// radius), and return the closest one that is a real airport with an IATA code.

function haversineKm(la1, lo1, la2, lo2) {
  const R = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default async function handler(req, res) {
  const token = process.env.DUFFEL_TOKEN;
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  const name = (req.query.name || "").toString().trim();
  if (!token) return res.status(200).json({ ok: false, reason: "no-token" });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(200).json({ ok: false, reason: "need-coords" });

  try {
    // Duffel's radius search returns airports and cities within range of a point.
    const r = await fetch(`https://api.duffel.com/places/suggestions?lat=${lat}&lng=${lng}&rad=150000`, {
      headers: { "Accept": "application/json", "Duffel-Version": "v2", "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "duffel-error", status: r.status, detail: detail.slice(0, 160) });
    }
    const data = await r.json();
    const places = (data.data || []).filter((p) => p.iata_code);

    // Rank every airport we got back by true distance from the place, nearest first.
    const airports = places
      .filter((p) => p.type === "airport" && p.latitude != null && p.longitude != null)
      .map((p) => ({
        code: p.iata_code,
        name: p.name,
        cityName: p.city_name || p.name,
        km: Math.round(haversineKm(lat, lng, p.latitude, p.longitude)),
      }))
      .sort((a, b) => a.km - b.km);

    if (!airports.length) return res.status(200).json({ ok: true, name, nearest: null, note: "no-airport-in-range" });

    const nearest = airports[0];
    // If the nearest airport is effectively in the place itself (< 25 km), the place is its
    // own gateway — you fly straight there. Otherwise it is a ground-access place and the
    // journey is: fly to the airport, then overland.
    const groundAccess = nearest.km >= 25;

    res.setHeader("Cache-Control", "s-maxage=2592000, stale-while-revalidate=31536000");
    return res.status(200).json({
      ok: true,
      name,
      nearest: { code: nearest.code, airport: nearest.name, city: nearest.cityName, km: nearest.km },
      groundAccess,
      alternatives: airports.slice(1, 4).map((a) => ({ code: a.code, city: a.cityName, km: a.km })),
    });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 160) });
  }
}
