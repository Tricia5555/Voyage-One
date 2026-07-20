// Voyage One — real hotels with real prices, from Duffel Stays.
//
// Runs on Vercel's servers with the DUFFEL_TOKEN, never in the browser. Given a city's
// coordinates and check-in / check-out dates, it asks Duffel for real available hotels and
// their genuine cheapest nightly rate. In Duffel TEST mode these are sample properties; flip
// the token to a live one and the same code returns real rates from 1M+ properties.
//
// Duffel Stays search flow: POST /stays/search with location {lat,long,radius} + dates +
// guests. Each result carries cheapest_rate_total_amount, which Duffel documents as always
// accurate. We divide by nights to show a per-night figure.

// Coordinates for the cities the app knows. Kept server-side so we never trust the client.
const COORDS = {
  "Miami":[25.77,-80.19],"New York City":[40.71,-74.01],"Los Angeles":[34.05,-118.24],"San Francisco":[37.77,-122.42],
  "Chicago":[41.88,-87.63],"Boston":[42.36,-71.06],"Washington DC":[38.91,-77.04],"Seattle":[47.61,-122.33],"Newark":[40.74,-74.17],
  "Napa Valley":[38.30,-122.29],"Phoenix":[33.45,-112.07],"Calgary":[51.05,-114.07],"Sapporo":[43.06,141.35],"Sedona":[34.87,-111.76],"Aspen":[39.19,-106.82],"Banff":[51.18,-115.57],"Toronto":[43.65,-79.38],
  "Vancouver":[49.28,-123.12],"Mexico City":[19.43,-99.13],"Buenos Aires":[-34.60,-58.38],"Mendoza":[-32.89,-68.84],
  "Costa Rica":[9.75,-83.75],"Galápagos":[-0.74,-90.31],"Turks & Caicos":[21.69,-71.80],
  "London":[51.51,-0.13],"Paris":[48.86,2.35],"Rome":[41.90,12.50],"Florence":[43.77,11.26],"Venice":[45.44,12.32],
  "Milan":[45.46,9.19],"Naples":[40.85,14.27],"Palermo":[38.12,13.36],"Sorrento":[40.63,14.37],"Positano":[40.63,14.48],
  "Amalfi":[40.63,14.60],"Ravello":[40.65,14.61],"Capri":[40.55,14.24],"Amalfi Coast":[40.63,14.55],"Tuscany":[43.40,11.30],
  "Siena":[43.32,11.33],"Lucca":[43.84,10.50],"San Gimignano":[43.47,11.04],"Montalcino":[43.06,11.49],"Lake Como":[45.98,9.26],
  "Dolomites":[46.41,11.84],"Cinque Terre":[44.13,9.71],"Pisa":[43.72,10.40],"Geneva":[46.20,6.14],"Lyon":[45.76,4.84],
  "Madrid":[40.42,-3.70],"Barcelona":[41.39,2.17],"Seville":[37.39,-5.99],"Granada":[37.18,-3.60],"Mallorca":[39.57,2.65],
  "Lisbon":[38.72,-9.14],"Porto":[41.15,-8.61],"Sintra":[38.80,-9.39],"Cascais":[38.70,-9.42],"Óbidos":[39.36,-9.16],
  "Comporta":[38.38,-8.78],"Évora":[38.57,-7.91],"Algarve":[37.09,-8.25],"Faro":[37.02,-7.93],"Douro Valley":[41.16,-7.79],"Portugal":[39.40,-8.22],
  "Amsterdam":[52.37,4.90],"Berlin":[52.52,13.40],"Munich":[48.14,11.58],"Vienna":[48.21,16.37],"Prague":[50.08,14.44],
  "Zurich":[47.38,8.54],"Zermatt":[46.02,7.75],"Chamonix":[45.92,6.87],"Courchevel":[45.41,6.63],"Provence":[43.93,5.05],
  "Marseille":[43.30,5.37],"Bordeaux":[44.84,-0.58],"Nice":[43.70,7.27],"Dublin":[53.35,-6.26],"Edinburgh":[55.95,-3.19],
  "St Andrews":[56.34,-2.79],"Athens":[37.98,23.73],"Santorini":[36.39,25.46],"Mykonos":[37.45,25.33],"Istanbul":[41.01,28.98],
  "Dubrovnik":[42.65,18.09],"Reykjavik":[64.15,-21.94],
  "Dubai":[25.20,55.27],"Marrakech":[31.63,-8.01],"Tokyo":[35.68,139.65],"Kyoto":[35.01,135.77],"Niseko":[42.80,140.69],
  "Singapore":[1.35,103.82],"Hong Kong":[22.32,114.17],"Bangkok":[13.76,100.50],"Bali":[-8.34,115.09],"Maldives":[3.20,73.22],
  "Sydney":[-33.87,151.21],"Queenstown":[-45.03,168.66],"Cape Town":[-33.92,18.42],"Kruger":[-24.01,31.49],
  "Serengeti":[-2.33,34.83],"Kilimanjaro":[-3.43,37.07],
};

function coordsFor(city) {
  if (!city) return null;
  const key = Object.keys(COORDS).find((k) => k.toLowerCase() === city.trim().toLowerCase());
  return key ? COORDS[key] : null;
}
function nightsBetween(a, b) {
  const d1 = new Date(a + "T00:00:00"), d2 = new Date(b + "T00:00:00");
  const n = Math.round((d2 - d1) / 86400000);
  return n > 0 ? n : 1;
}
// Tier a hotel by its real per-night price. UltraLux stays a genuine global standard.
function tierFor(perNight) {
  if (perNight == null) return "Refined";
  if (perNight >= 650) return "UltraLux";
  if (perNight >= 350) return "Luxury";
  if (perNight >= 180) return "Refined";
  return "Essential";
}

export default async function handler(req, res) {
  const token = process.env.DUFFEL_TOKEN;
  const city = (req.query.city || "").toString().trim();
  const checkIn = (req.query.in || "").toString().trim();
  const checkOut = (req.query.out || "").toString().trim();

  if (!token) return res.status(200).json({ ok: false, reason: "no-token" });
  const c = coordsFor(city);
  if (!c) return res.status(200).json({ ok: false, reason: "unknown-city", city });

  // Default to a sensible 2-night window ~60 days out if dates weren't supplied.
  let ci = checkIn, co = checkOut;
  if (!ci || !co) {
    const start = new Date(Date.now() + 60 * 86400000);
    const end = new Date(start.getTime() + 2 * 86400000);
    ci = start.toISOString().slice(0, 10);
    co = end.toISOString().slice(0, 10);
  }
  const nights = nightsBetween(ci, co);

  try {
    const r = await fetch("https://api.duffel.com/stays/search", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Duffel-Version": "v2",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        data: {
          location: { radius: 8, geographic_coordinates: { latitude: c[0], longitude: c[1] } },
          check_in_date: ci,
          check_out_date: co,
          guests: [{ type: "adult" }, { type: "adult" }],
          rooms: 1,
        },
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "duffel-error", status: r.status, detail: detail.slice(0, 300) });
    }
    const data = await r.json();
    const results = (data.data && data.data.results) || [];

    const hotels = results.map((s) => {
      const acc = s.accommodation || {};
      const total = s.cheapest_rate_total_amount ? parseFloat(s.cheapest_rate_total_amount) : null;
      const perNight = total != null ? Math.round(total / nights) : null;
      const photo = acc.photos && acc.photos[0] ? (acc.photos[0].url || null) : null;
      const rating = acc.rating != null ? acc.rating : (acc.review_score != null ? acc.review_score : null);
      return {
        id: acc.id || s.id,
        name: acc.name || "Hotel",
        perNight,
        currency: s.cheapest_rate_total_currency || "USD",
        tier: tierFor(perNight),
        rating,
        desc: acc.description ? String(acc.description).slice(0, 160) : "",
        photo,
        searchResultId: s.id,
      };
    }).filter((h) => h.name);

    // Group into the app's four tiers, best (by price within tier) first, cap the list.
    const grouped = { UltraLux: [], Luxury: [], Refined: [], Essential: [] };
    hotels.forEach((h) => grouped[h.tier].push(h));
    for (const k of Object.keys(grouped)) {
      grouped[k].sort((a, b) => (b.perNight || 0) - (a.perNight || 0));
      grouped[k] = grouped[k].slice(0, 10);
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ ok: true, city, checkIn: ci, checkOut: co, nights, hotels: grouped, source: "Duffel" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
