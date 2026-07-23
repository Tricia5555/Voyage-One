// Voyage One — real flight fares from Duffel Flights (self-serve, no approval gate).
//
// Runs on Vercel with DUFFEL_TOKEN, never in the browser. Given from/to cities, a date and
// cabin, it turns the cities into airport codes, asks Duffel for real airline offers, and
// returns the cheapest genuine fare per cabin. In Duffel TEST mode the airline is "Duffel
// Airways" with sample fares; flip the token to live and the same code returns real prices.
//
// Flight search: POST /air/offer_requests with slices + passengers + cabin_class.
// Duffel returns offers, each with a real total_amount. We take the cheapest.

const AIRPORTS = {
  "New York City": { code: "JFK", scale: "intercontinental" }, "Miami": { code: "MIA", scale: "intercontinental" },
  "Los Angeles": { code: "LAX", scale: "intercontinental" }, "San Francisco": { code: "SFO", scale: "intercontinental" },
  "Chicago": { code: "ORD", scale: "intercontinental" }, "Boston": { code: "BOS", scale: "intercontinental" },
  "Washington DC": { code: "IAD", scale: "intercontinental" }, "Newark": { code: "EWR", scale: "intercontinental" },
  "Washington": { code: "IAD", scale: "intercontinental" }, "Atlanta": { code: "ATL", scale: "intercontinental" },
  "Dallas": { code: "DFW", scale: "intercontinental" }, "Denver": { code: "DEN", scale: "intercontinental" },
  "Houston": { code: "IAH", scale: "intercontinental" }, "Los Angeles": { code: "LAX", scale: "intercontinental" },
  "San Francisco": { code: "SFO", scale: "intercontinental" }, "San Diego": { code: "SAN", scale: "intercontinental" },
  "Las Vegas": { code: "LAS", scale: "intercontinental" }, "Orlando": { code: "MCO", scale: "intercontinental" },
  "Nashville": { code: "BNA", scale: "intercontinental" }, "New Orleans": { code: "MSY", scale: "intercontinental" },
  "Austin": { code: "AUS", scale: "intercontinental" }, "Minneapolis": { code: "MSP", scale: "intercontinental" },
  "Detroit": { code: "DTW", scale: "intercontinental" }, "Charlotte": { code: "CLT", scale: "intercontinental" },
  "Philadelphia": { code: "PHL", scale: "intercontinental" }, "Salt Lake City": { code: "SLC", scale: "intercontinental" },
  "Portland": { code: "PDX", scale: "intercontinental" }, "Tampa": { code: "TPA", scale: "intercontinental" },
  "Fort Lauderdale": { code: "FLL", scale: "intercontinental" }, "Honolulu": { code: "HNL", scale: "intercontinental" },
  "London": { code: "LHR", scale: "intercontinental" }, "Paris": { code: "CDG", scale: "intercontinental" },
  "Milan": { code: "MXP", scale: "intercontinental" }, "Rome": { code: "FCO", scale: "intercontinental" },
  "Madrid": { code: "MAD", scale: "intercontinental" }, "Barcelona": { code: "BCN", scale: "intercontinental" },
  "Lisbon": { code: "LIS", scale: "intercontinental" }, "Amsterdam": { code: "AMS", scale: "intercontinental" },
  "Zurich": { code: "ZRH", scale: "intercontinental" }, "Munich": { code: "MUC", scale: "intercontinental" },
  "Athens": { code: "ATH", scale: "intercontinental" }, "Dubai": { code: "DXB", scale: "intercontinental" },
  "Tokyo": { code: "HND", scale: "intercontinental" }, "Singapore": { code: "SIN", scale: "intercontinental" },
  "Venice": { code: "VCE", scale: "regional" }, "Florence": { code: "FLR", scale: "regional" },
  "Naples": { code: "NAP", scale: "regional" }, "Palermo": { code: "PMO", scale: "regional" },
  "Porto": { code: "OPO", scale: "regional" }, "Faro": { code: "FAO", scale: "regional" },
  "Pisa": { code: "PSA", scale: "regional" }, "Nice": { code: "NCE", scale: "regional" },
  "Marseille": { code: "MRS", scale: "regional" }, "Santorini": { code: "JTR", scale: "regional" },
  "Mykonos": { code: "JMK", scale: "regional" }, "Mallorca": { code: "PMI", scale: "regional" },
  "Geneva": { code: "GVA", scale: "regional" }, "Lyon": { code: "LYS", scale: "regional" },
  "Seville": { code: "SVQ", scale: "regional" }, "Granada": { code: "GRX", scale: "regional" },
  "Edinburgh": { code: "EDI", scale: "regional" }, "Dublin": { code: "DUB", scale: "intercontinental" },
  "Phoenix": { code: "PHX", scale: "intercontinental" }, "Calgary": { code: "YYC", scale: "intercontinental" },
  "Sapporo": { code: "CTS", scale: "regional" }, "Kilimanjaro": { code: "JRO", scale: "regional" },
  "Aspen": { code: "ASE", scale: "regional" }, "Toronto": { code: "YYZ", scale: "intercontinental" },
  "Vancouver": { code: "YVR", scale: "intercontinental" }, "Seattle": { code: "SEA", scale: "intercontinental" },
  "Hong Kong": { code: "HKG", scale: "intercontinental" }, "Bangkok": { code: "BKK", scale: "intercontinental" },
  "Bali": { code: "DPS", scale: "intercontinental" }, "Denpasar": { code: "DPS", scale: "intercontinental" },
  "Sydney": { code: "SYD", scale: "intercontinental" }, "Melbourne": { code: "MEL", scale: "intercontinental" },
  "Cape Town": { code: "CPT", scale: "intercontinental" }, "Johannesburg": { code: "JNB", scale: "intercontinental" },
  "Kyoto": { code: "KIX", scale: "intercontinental" }, "Osaka": { code: "KIX", scale: "intercontinental" },
  "Seoul": { code: "ICN", scale: "intercontinental" }, "Shanghai": { code: "PVG", scale: "intercontinental" },
  "Beijing": { code: "PEK", scale: "intercontinental" }, "Taipei": { code: "TPE", scale: "intercontinental" },
  "Marrakech": { code: "RAK", scale: "intercontinental" }, "Reykjavik": { code: "KEF", scale: "intercontinental" },
  "Istanbul": { code: "IST", scale: "intercontinental" }, "Doha": { code: "DOH", scale: "intercontinental" },
  "Abu Dhabi": { code: "AUH", scale: "intercontinental" }, "Mumbai": { code: "BOM", scale: "intercontinental" },
  "Delhi": { code: "DEL", scale: "intercontinental" }, "Cairo": { code: "CAI", scale: "intercontinental" },
  "Nairobi": { code: "NBO", scale: "intercontinental" }, "Rio de Janeiro": { code: "GIG", scale: "intercontinental" },
  "Sao Paulo": { code: "GRU", scale: "intercontinental" }, "Buenos Aires": { code: "EZE", scale: "intercontinental" },
  "Mexico City": { code: "MEX", scale: "intercontinental" }, "Lima": { code: "LIM", scale: "intercontinental" },
  "Vienna": { code: "VIE", scale: "intercontinental" }, "Prague": { code: "PRG", scale: "intercontinental" },
  "Budapest": { code: "BUD", scale: "intercontinental" }, "Copenhagen": { code: "CPH", scale: "intercontinental" },
  "Stockholm": { code: "ARN", scale: "intercontinental" }, "Oslo": { code: "OSL", scale: "intercontinental" },
  "Helsinki": { code: "HEL", scale: "intercontinental" }, "Brussels": { code: "BRU", scale: "intercontinental" },
  "Frankfurt": { code: "FRA", scale: "intercontinental" }, "Berlin": { code: "BER", scale: "intercontinental" },
  "Dallas": { code: "DFW", scale: "intercontinental" }, "Atlanta": { code: "ATL", scale: "intercontinental" },
  "Denver": { code: "DEN", scale: "intercontinental" }, "Honolulu": { code: "HNL", scale: "intercontinental" },
  "Las Vegas": { code: "LAS", scale: "intercontinental" }, "Orlando": { code: "MCO", scale: "intercontinental" },
  "Houston": { code: "IAH", scale: "intercontinental" }, "Cancun": { code: "CUN", scale: "intercontinental" },
  "Maui": { code: "OGG", scale: "regional" }, "Tahiti": { code: "PPT", scale: "intercontinental" },
  "Auckland": { code: "AKL", scale: "intercontinental" }, "Nadi": { code: "NAN", scale: "intercontinental" },
  "Maldives": { code: "MLE", scale: "intercontinental" }, "Male": { code: "MLE", scale: "intercontinental" },
};

function iataFor(city) {
  if (!city) return null;
  const key = Object.keys(AIRPORTS).find((k) => k.toLowerCase() === city.trim().toLowerCase());
  return key ? AIRPORTS[key].code : null;
}

export default async function handler(req, res) {
  const token = process.env.DUFFEL_TOKEN;
  const from = (req.query.from || "").toString().trim();
  const to = (req.query.to || "").toString().trim();
  const date = (req.query.date || "").toString().trim();
  const cabin = (req.query.cabin || "economy").toString().trim().toLowerCase();

  if (!token) return res.status(200).json({ ok: false, reason: "no-token" });

  const origin = iataFor(from) || (from.length === 3 ? from.toUpperCase() : null);
  const destination = iataFor(to) || (to.length === 3 ? to.toUpperCase() : null);
  if (!origin || !destination) return res.status(200).json({ ok: false, reason: "unknown-airport", from, to });

  // Default to ~60 days out if no date given.
  let dep = date;
  if (!dep) dep = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const cabinClass = ["economy", "premium_economy", "business", "first"].includes(cabin) ? cabin : "economy";

  try {
    const r = await fetch("https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=15000", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Duffel-Version": "v2",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        data: {
          slices: [{ origin, destination, departure_date: dep }],
          passengers: [{ type: "adult" }],
          cabin_class: cabinClass,
        },
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "duffel-error", status: r.status, detail: detail.slice(0, 300) });
    }
    const data = await r.json();
    const offers = (data.data && data.data.offers) || [];
    if (!offers.length) return res.status(200).json({ ok: true, from: origin, to: destination, date: dep, cabin: cabinClass, offers: [], note: "no-offers" });

    // Cheapest first; return a handful with airline, times, and stops for a real picker.
    const parsed = offers.map((o) => {
      const slice = (o.slices && o.slices[0]) || {};
      const segs = slice.segments || [];
      const first = segs[0] || {};
      const last = segs[segs.length - 1] || {};
      const timeOf = (iso) => {
        if (!iso) return null;
        // Duffel gives local ISO like "2026-09-01T11:15:00". Take the HH:MM.
        const m = /T(\d{2}:\d{2})/.exec(iso);
        return m ? m[1] : null;
      };
      return {
        price: o.total_amount ? Math.round(parseFloat(o.total_amount)) : null,
        currency: o.total_currency || "USD",
        airline: (o.owner && o.owner.name) || "Airline",
        depart: timeOf(first.departing_at),
        arrive: timeOf(last.arriving_at),
        stops: segs.length > 0 ? segs.length - 1 : 0,
        flightNo: (first.operating_carrier_flight_number || first.marketing_carrier_flight_number) ? `${(first.marketing_carrier && first.marketing_carrier.iata_code) || ""}${first.marketing_carrier_flight_number || ""}` : null,
        offerId: o.id,
      };
    }).filter((o) => o.price != null);

    // Rank by world airline quality (Skytrax 2025/26 order), then reward nonstop so a
    // top-ranked carrier that only offers an absurd detour doesn't beat a great nonstop.
    // Quality leads; sensible routing keeps it honest; price is only the final tiebreak.
    const PREFERRED = [
      "Qatar Airways", "Singapore Airlines", "Cathay Pacific", "Emirates", "ANA", "All Nippon",
      "Turkish Airlines", "EVA Air", "Korean Air", "Air France", "Swiss", "Japan Airlines",
      "Hainan", "Lufthansa", "British Airways", "Qantas", "Virgin Atlantic", "KLM",
      "Iberia", "Etihad", "Air Canada", "Finnair", "Austrian", "Brussels", "ITA Airways",
      "Alitalia", "Delta", "United", "American Airlines",
    ];
    const rank = (name) => { const i = PREFERRED.findIndex((p) => (name || "").toLowerCase().includes(p.toLowerCase())); return i === -1 ? 999 : i; };
    parsed.sort((a, b) => {
      // Nonstop almost always wins on convenience — a connection has to come from a
      // dramatically better airline to compete. Big penalty per stop keeps a via-Istanbul
      // Turkish flight from beating a nonstop Air France/Virgin on a transatlantic hop.
      const sa = rank(a.airline) + a.stops * 40;
      const sb = rank(b.airline) + b.stops * 40;
      if (sa !== sb) return sa - sb;
      return a.price - b.price;
    });

    // Lead card: the best preferred, nonstop option — not merely the cheapest.
    const cheapest = parsed[0] || null;

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=43200");
    // Duffel returns the SAME physical flight many times over — one entry per fare brand.
    // Left alone, eight slots fill with five copies of one departure and the traveller never
    // sees the 8am they actually wanted. Collapse to one row per real flight (airline +
    // flight number + departure), keeping the lowest fare found for it.
    const seen = new Map();
    for (const o of parsed) {
      const k = `${o.airline}|${o.flightNo || ""}|${o.depart || ""}`;
      const prev = seen.get(k);
      if (!prev || (o.price != null && o.price < prev.price)) seen.set(k, o);
    }
    const distinct = Array.from(seen.values());
    // Re-apply the ranking, since the map lost the original order.
    distinct.sort((a, b) => {
      const sa = rank(a.airline) + a.stops * 40;
      const sb = rank(b.airline) + b.stops * 40;
      if (sa !== sb) return sa - sb;
      return a.price - b.price;
    });

    return res.status(200).json({ ok: true, from: origin, to: destination, date: dep, cabin: cabinClass, cheapest: distinct[0] || cheapest, offers: distinct.slice(0, 20), source: "Duffel" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
