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

    if (!airports.length) return res.status(200).json({ ok: true, name, options: [], note: "no-airport-in-range" });

    // The honest questions a traveller has: which airports are near here, and how far is the
    // drive from each? Answer those and let the client choose — no guessing whether a city
    // "owns" its airport. We take the nearest few, add a real driving time (Google Routes) and
    // a quick check of whether flights actually operate, then present them.
    const candidates = airports.slice(0, 3);
    const gKey = process.env.GOOGLE_PLACES_KEY;
    const probeDate = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    const REFERENCE = "LHR";

    const enriched = await Promise.all(candidates.map(async (a) => {
      // Real driving time from the place to this airport.
      let driveMin = null, driveKm = null;
      if (gKey) {
        try {
          const dr = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Goog-Api-Key": gKey, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters" },
            body: JSON.stringify({ origin: { location: { latLng: { latitude: lat, longitude: lng } } }, destination: { address: `${a.name} ${a.code} airport` }, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" }),
          });
          if (dr.ok) {
            const dd = await dr.json();
            const rt = (dd.routes || [])[0];
            if (rt) {
              const m = /^(\d+)s$/.exec(rt.duration || "");
              if (m) driveMin = Math.round(parseInt(m[1]) / 60);
              if (rt.distanceMeters) driveKm = Math.round(rt.distanceMeters / 1000);
            }
          }
        } catch (e) { /* leave null */ }
      }
      // Does anything actually fly from here? (Aspen: yes, bumpy but real. Private field: no.)
      let hasService = null;
      if (a.code === REFERENCE) hasService = true;
      else {
        try {
          const pr = await fetch("https://api.duffel.com/air/offer_requests?return_offers=false", {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/json", "Duffel-Version": "v2", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ data: { slices: [{ origin: a.code, destination: REFERENCE, departure_date: probeDate }], passengers: [{ type: "adult" }], cabin_class: "economy" } }),
          });
          if (pr.ok) { const pd = await pr.json(); hasService = !!(pd.data && pd.data.id); }
        } catch (e) { /* unknown */ }
      }
      return {
        code: a.code, city: a.cityName, airport: a.name,
        km: driveKm != null ? driveKm : a.km,        // real road km if we got it, else straight-line
        driveMin, straightKm: a.km, hasService,
        // An airport within ~18 km straight-line effectively IS this city's own airport,
        // whatever it's named (Florence's is "Amerigo Vespucci", Rome's "Leonardo da Vinci").
        // Proximity is name-independent and reliable where name-matching fails.
        isOwn: a.km <= 18,
      };
    }));

    // Present nearest first; real service ordered ahead of private-only fields at similar range.
    const rank = (x) => (x.hasService === true ? 0 : x.hasService === null ? 1 : 2);
    enriched.sort((a, b) => (rank(a) - rank(b)) || ((a.driveMin ?? a.km) - (b.driveMin ?? b.km)));

    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=2592000");
    return res.status(200).json({ ok: true, name, options: enriched });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 160) });
  }
}
