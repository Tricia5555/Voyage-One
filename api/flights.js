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

    // A luxury planner should lead with the airlines travelers actually want — the great
    // full-service carriers — not the cheapest obscure fare. We rank by airline prestige and
    // nonstop convenience, NOT by lowest price. Price is shown; it just isn't the sort key.
    const PREFERRED = [
      "British Airways", "American Airlines", "United Airlines", "Delta", "Air France",
      "KLM", "Lufthansa", "Swiss", "Iberia", "Qatar Airways", "Emirates", "Singapore Airlines",
      "Cathay Pacific", "Qantas", "Virgin Atlantic", "ITA Airways", "Alitalia", "Finnair",
      "Austrian", "Turkish Airlines", "Air Canada", "Japan Airlines", "All Nippon",
    ];
    const rank = (name) => { const i = PREFERRED.findIndex((p) => (name || "").toLowerCase().includes(p.toLowerCase())); return i === -1 ? 999 : i; };
    parsed.sort((a, b) => {
      const ra = rank(a.airline), rb = rank(b.airline);
      if (ra !== rb) return ra - rb;               // preferred carriers first
      if (a.stops !== b.stops) return a.stops - b.stops; // then nonstop over connections
      return a.price - b.price;                    // only then, cheaper first as a tiebreak
    });

    // Lead card: the best preferred, nonstop option — not merely the cheapest.
    const cheapest = parsed[0] || null;

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=43200");
    return res.status(200).json({ ok: true, from: origin, to: destination, date: dep, cabin: cabinClass, cheapest, offers: parsed.slice(0, 8), source: "Duffel" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
