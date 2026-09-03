// Voyage One — real flight fares from Duffel Flights (self-serve, no approval gate).
//
// Runs on Vercel with DUFFEL_TOKEN, never in the browser. Given from/to cities, a date and
// cabin, it turns the cities into airport codes, asks Duffel for real airline offers, and
// returns them with every leg intact so the traveller can judge the journey, not just a price.
//
// Flight search: POST /air/offer_requests with slices + passengers + cabin_class.
//
// Query params:
//   from, to      city name, "City (CODE)", or a bare IATA code
//   date          YYYY-MM-DD (defaults ~60 days out)
//   cabin         economy | premium_economy | business | first
//   stops         "0" nonstop only | "1" one stop or fewer | "" any
//   when          morning | afternoon | evening (departure window)
//   airline       comma-separated names to INCLUDE (substring, case-insensitive)
//   exclude       comma-separated names to EXCLUDE
//   country       ISO country hint for ambiguous city names, e.g. IT for Florence

const AIRPORTS = {
  // Metro cities with several airports use the IATA *city* code, which Duffel expands to all
  // of them — so New York searches JFK, LaGuardia AND Newark, not just JFK, and a LaGuardia
  // nonstop is found. Same for London (Heathrow/Gatwick/City/Stansted/Luton) and others.
  "New York City": { code: "NYC", scale: "intercontinental" }, "Miami": { code: "MIA", scale: "intercontinental" },
  "Los Angeles": { code: "LAX", scale: "intercontinental" }, "San Francisco": { code: "SFO", scale: "intercontinental" },
  "Chicago": { code: "CHI", scale: "intercontinental" }, "Boston": { code: "BOS", scale: "intercontinental" },
  "Washington DC": { code: "WAS", scale: "intercontinental" }, "Newark": { code: "EWR", scale: "intercontinental" },
  "Washington": { code: "IAD", scale: "intercontinental" }, "Atlanta": { code: "ATL", scale: "intercontinental" },
  "Dallas": { code: "DFW", scale: "intercontinental" }, "Denver": { code: "DEN", scale: "intercontinental" },
  "Houston": { code: "IAH", scale: "intercontinental" }, "San Diego": { code: "SAN", scale: "intercontinental" },
  "Las Vegas": { code: "LAS", scale: "intercontinental" }, "Orlando": { code: "MCO", scale: "intercontinental" },
  "Nashville": { code: "BNA", scale: "intercontinental" }, "New Orleans": { code: "MSY", scale: "intercontinental" },
  "Austin": { code: "AUS", scale: "intercontinental" }, "Minneapolis": { code: "MSP", scale: "intercontinental" },
  "Detroit": { code: "DTW", scale: "intercontinental" }, "Charlotte": { code: "CLT", scale: "intercontinental" },
  "Philadelphia": { code: "PHL", scale: "intercontinental" }, "Salt Lake City": { code: "SLC", scale: "intercontinental" },
  "Portland": { code: "PDX", scale: "intercontinental" }, "Tampa": { code: "TPA", scale: "intercontinental" },
  "Fort Lauderdale": { code: "FLL", scale: "intercontinental" }, "Honolulu": { code: "HNL", scale: "intercontinental" },
  "Birmingham AL": { code: "BHM", scale: "regional" }, "Birmingham, AL": { code: "BHM", scale: "regional" },
  "Nashville TN": { code: "BNA", scale: "regional" }, "Charleston": { code: "CHS", scale: "regional" },
  "Savannah": { code: "SAV", scale: "regional" }, "Jacksonville": { code: "JAX", scale: "regional" },
  "Raleigh": { code: "RDU", scale: "regional" }, "Richmond": { code: "RIC", scale: "regional" },
  "Pittsburgh": { code: "PIT", scale: "regional" }, "Cleveland": { code: "CLE", scale: "regional" },
  "Cincinnati": { code: "CVG", scale: "regional" }, "Indianapolis": { code: "IND", scale: "regional" },
  "Kansas City": { code: "MCI", scale: "regional" }, "St Louis": { code: "STL", scale: "regional" },
  "Memphis": { code: "MEM", scale: "regional" }, "Louisville": { code: "SDF", scale: "regional" },
  "Columbus": { code: "CMH", scale: "regional" }, "Milwaukee": { code: "MKE", scale: "regional" },
  "Sacramento": { code: "SMF", scale: "regional" }, "San Jose": { code: "SJC", scale: "regional" },
  "Palm Beach": { code: "PBI", scale: "regional" }, "West Palm Beach": { code: "PBI", scale: "regional" },
  "Naples FL": { code: "RSW", scale: "regional" }, "Fort Myers": { code: "RSW", scale: "regional" },
  "Sarasota": { code: "SRQ", scale: "regional" }, "Key West": { code: "EYW", scale: "regional" },
  "London": { code: "LON", scale: "intercontinental" }, "Paris": { code: "PAR", scale: "intercontinental" },
  "Milan": { code: "MXP", scale: "intercontinental" }, "Rome": { code: "FCO", scale: "intercontinental" },
  "Madrid": { code: "MAD", scale: "intercontinental" }, "Barcelona": { code: "BCN", scale: "intercontinental" },
  "Lisbon": { code: "LIS", scale: "intercontinental" }, "Amsterdam": { code: "AMS", scale: "intercontinental" },
  "Zurich": { code: "ZRH", scale: "intercontinental" }, "Munich": { code: "MUC", scale: "intercontinental" },
  "Athens": { code: "ATH", scale: "intercontinental" }, "Dubai": { code: "DXB", scale: "intercontinental" },
  "Tokyo": { code: "TYO", scale: "intercontinental" }, "Singapore": { code: "SIN", scale: "intercontinental" },
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
  "Cancun": { code: "CUN", scale: "intercontinental" }, "Maui": { code: "OGG", scale: "regional" },
  "Tahiti": { code: "PPT", scale: "intercontinental" }, "Auckland": { code: "AKL", scale: "intercontinental" },
  "Nadi": { code: "NAN", scale: "intercontinental" },
  "Maldives": { code: "MLE", scale: "intercontinental" }, "Male": { code: "MLE", scale: "intercontinental" },
};

function iataFor(city) {
  if (!city) return null;
  const key = Object.keys(AIRPORTS).find((k) => k.toLowerCase() === city.trim().toLowerCase());
  return key ? AIRPORTS[key].code : null;
}

// The hand-written list above is a fast path for common cities, not the limit of what we
// support. Anything it does not know — Bilbao, Charleston — gets looked up live against
// Duffel's place suggestions, so any real airport city can start or end a trip.
const LOOKUP_CACHE = new Map();
// US state abbreviations, so "Birmingham AL" finds Alabama rather than failing outright
// (and is not quietly handed to Birmingham, England).
const US_STATES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);

async function suggest(query, token) {
  try {
    const r = await fetch(`https://api.duffel.com/places/suggestions?query=${encodeURIComponent(query)}`, {
      headers: { "Accept": "application/json", "Duffel-Version": "v2", "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return data.data || [];
  } catch (e) { return []; }
}

// Returns { code, country, name, source } so the caller can SEE what was chosen and tell the
// traveller. A silent wrong airport is the worst failure this endpoint can have.
async function resolveCity(city, token, countryHint) {
  // If the traveller picked from the suggestion list, the code came with it — "Florence
  // (FLR)" — and that exact airport is what they chose. Honour it, always, first.
  const picked = /\(([A-Z]{3})\)\s*$/.exec(city || "");
  if (picked) return { code: picked[1], country: null, name: null, source: "picked" };

  let q = (city || "").trim();
  if (!q) return null;
  // A bare 3-letter code typed directly.
  if (q.length === 3 && /^[A-Za-z]{3}$/.test(q)) return { code: q.toUpperCase(), country: null, name: null, source: "code" };

  // "Birmingham, AL" / "Birmingham AL" — remember the state, then search the bare city name.
  let wantCountry = countryHint ? countryHint.toUpperCase() : null;
  const m = /^(.*?)[,\s]+([A-Za-z]{2})$/.exec(q);
  if (m && US_STATES.has(m[2].toUpperCase())) { q = m[1].trim(); wantCountry = "US"; }

  const ck = `${q.toLowerCase()}|${wantCountry || ""}`;
  if (LOOKUP_CACHE.has(ck)) return LOOKUP_CACHE.get(ck);

  // Ask Duffel first, and PREFER the metropolitan "city" code. Duffel expands a city code to
  // every airport in the metro — so New York becomes JFK+LGA+EWR, London all five, Paris
  // CDG+ORY — with no per-city list to maintain.
  const places = await suggest(q, token);
  const pick = (arr) => {
    const inCountry = wantCountry ? arr.filter((p) => p.iata_country_code === wantCountry) : arr;
    const pool = inCountry.length ? inCountry : (wantCountry ? [] : arr);
    return (pool.find((p) => p.type === "city" && p.iata_code)
      || pool.find((p) => p.type === "airport" && p.iata_code) || null);
  };
  const hit = pick(places);

  let out = null;
  if (hit) {
    out = { code: hit.iata_code, country: hit.iata_country_code || null, name: hit.name || null, source: "duffel" };
  } else {
    const local = iataFor(city);
    if (local) out = { code: local, country: null, name: null, source: "table" };
  }

  // How many DIFFERENT countries answer to this name? If more than one, the name is ambiguous
  // and the caller should say so rather than pretend the first hit was obviously right.
  if (out && !wantCountry) {
    const countries = new Set(places.filter((p) => p.iata_code && p.iata_country_code).map((p) => p.iata_country_code));
    out.ambiguous = countries.size > 1;
    out.alsoIn = Array.from(countries).filter((c) => c !== out.country);
  }

  // Disambiguation by curated intent. When a bare name answers to more than one country,
  // Duffel ranks the US airport first — so "Florence" becomes Florence, South Carolina (FLO)
  // and the whole trip routes through Charlotte, and bare "Naples" could land in Florida.
  // Our AIRPORTS table encodes the airport a luxury traveller MEANS by that name (Florence =
  // FLR, Naples = NAP). On an ambiguous name we have a curated code for, trust the table to
  // break the tie. Universal: unaffected are unambiguous names (Milan → MIL), explicit picks
  // ("Florence (FLR)"), and state-qualified US names ("Florence SC" / "Naples FL"), which take
  // the wantCountry path above and never reach here.
  if (out && out.ambiguous && !wantCountry) {
    const curated = iataFor(city);
    if (curated && curated !== out.code) {
      out = { code: curated, country: null, name: null, source: "table-disambiguated", ambiguous: true, alsoIn: out.alsoIn };
    }
  }

  LOOKUP_CACHE.set(ck, out);
  return out;
}

export default async function handler(req, res) {
  const token = process.env.DUFFEL_TOKEN;
  const from = (req.query.from || "").toString().trim();
  const to = (req.query.to || "").toString().trim();
  const date = (req.query.date || "").toString().trim();
  const cabin = (req.query.cabin || "economy").toString().trim().toLowerCase();
  const countryHint = (req.query.country || "").toString().trim();

  if (!token) return res.status(200).json({ ok: false, reason: "no-token" });

  const originR = await resolveCity(from, token, countryHint);
  const destR = await resolveCity(to, token, countryHint);
  const origin = originR && originR.code;
  const destination = destR && destR.code;
  if (!origin || !destination) {
    return res.status(200).json({ ok: false, reason: "unknown-airport", from, to, unresolved: !origin ? from : to });
  }

  // Default to ~60 days out if no date given.
  let dep = date;
  if (!dep) dep = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const cabinClass = ["economy", "premium_economy", "business", "first"].includes(cabin) ? cabin : "economy";

  try {
    // supplier_timeout is how long Duffel may wait for slow airline suppliers before returning
    // what it has. It MUST stay comfortably below the Vercel function's own time limit, or
    // Vercel kills the function mid-wait and the traveller gets a raw "this Serverless Function
    // has crashed" page instead of flights — which is exactly what happened at 15000ms. Every
    // route that reaches this call (i.e. any real airport) was affected; airport-less towns
    // returned earlier, above, and so never tripped it. 7000ms leaves headroom for our own two
    // city lookups plus network on the tightest common function budget.
    const r = await fetch("https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=7000", {
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

    // Everything the caller needs to explain WHICH airports were searched — so a wrong
    // Florence is visible on screen instead of silently producing a strange price.
    const resolved = {
      from: { input: from, code: origin, country: originR.country, name: originR.name, source: originR.source, ambiguous: !!originR.ambiguous, alsoIn: originR.alsoIn || [] },
      to: { input: to, code: destination, country: destR.country, name: destR.name, source: destR.source, ambiguous: !!destR.ambiguous, alsoIn: destR.alsoIn || [] },
    };

    if (!offers.length) {
      return res.status(200).json({
        ok: true, from: origin, to: destination, date: dep, cabin: cabinClass,
        offers: [], airlines: [], note: "no-offers", resolved,
      });
    }

    const parsed = offers.map((o) => {
      const slice = (o.slices && o.slices[0]) || {};
      const segs = slice.segments || [];
      const first = segs[0] || {};
      const last = segs[segs.length - 1] || {};
      const dateOf = (iso) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso || ""); return m ? m[1] : null; };
      const timeOf = (iso) => { const m = /T(\d{2}:\d{2})/.exec(iso || ""); return m ? m[1] : null; };

      // Duffel's departing_at / arriving_at are LOCAL times with no zone offset in the string.
      // Subtracting them naively counts the timezone gap as flight time — so NYC→Madrid (a 7h
      // flight) reads as 13h because Madrid is 6h ahead. Duffel provides a per-segment
      // ISO-8601 `duration` that is already zone-correct; we use that.
      const parseDur = (d) => {
        if (!d) return null;
        const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(d);
        if (!m) return null;
        return (parseInt(m[1] || 0) * 1440) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
      };
      const localMs = (iso) => { const t = Date.parse((iso || "") + "Z"); return Number.isFinite(t) ? t : null; };

      // Flight (air) time: sum each segment's own duration — timezone-proof.
      let airMin = 0, haveAllDur = segs.length > 0;
      for (const s of segs) { const d = parseDur(s.duration); if (d == null) { haveAllDur = false; break; } airMin += d; }

      // Layovers: gap between one segment's arrival and the next's departure. Both are LOCAL to
      // the SAME airport (the connection point), so subtracting them is correct with no zone math.
      let layoverMin = 0, maxLayover = 0, haveLayovers = true;
      for (let k = 1; k < segs.length; k++) {
        const a = localMs(segs[k - 1].arriving_at), b = localMs(segs[k].departing_at);
        if (a == null || b == null || b < a) { haveLayovers = false; break; }
        const gap = Math.round((b - a) / 60000);
        layoverMin += gap; maxLayover = Math.max(maxLayover, gap);
      }

      let totalMin = (haveAllDur && haveLayovers) ? (airMin + layoverMin) : null;

      // Does it land on a later calendar day? Local dates are what the traveller reads.
      const dDate = dateOf(first.departing_at), aDate = dateOf(last.arriving_at);
      const dayOffset = (dDate && aDate) ? Math.round((Date.parse(aDate) - Date.parse(dDate)) / 86400000) : 0;

      // EVERY leg, with its own schedule and its own airline. Without this the traveller sees a
      // 21-hour total and no explanation of where the time went.
      const segments = segs.map((s, i) => {
        const mkt = s.marketing_carrier || {};
        const op = s.operating_carrier || {};
        let layoverAfterMin = null;
        if (i < segs.length - 1) {
          const a = localMs(s.arriving_at), b = localMs(segs[i + 1].departing_at);
          if (a != null && b != null && b >= a) layoverAfterMin = Math.round((b - a) / 60000);
        }
        return {
          leg: i + 1,
          from: (s.origin && s.origin.iata_code) || null,
          fromName: (s.origin && s.origin.name) || null,
          fromCity: (s.origin && s.origin.city_name) || null,
          to: (s.destination && s.destination.iata_code) || null,
          toName: (s.destination && s.destination.name) || null,
          toCity: (s.destination && s.destination.city_name) || null,
          departDate: dateOf(s.departing_at),
          depart: timeOf(s.departing_at),
          arriveDate: dateOf(s.arriving_at),
          arrive: timeOf(s.arriving_at),
          minutes: parseDur(s.duration),
          // The ticket says one airline; the aircraft may belong to another. Both matter:
          // "Lufthansa LX0019" was really SWISS metal sold under a Lufthansa offer.
          marketingCarrier: mkt.name || null,
          marketingCode: mkt.iata_code || null,
          operatingCarrier: op.name || mkt.name || null,
          operatingCode: op.iata_code || mkt.iata_code || null,
          flightNo: `${mkt.iata_code || ""}${s.marketing_carrier_flight_number || ""}` || null,
          aircraft: (s.aircraft && s.aircraft.name) || null,
          cabin: (s.passengers && s.passengers[0] && s.passengers[0].cabin_class_marketing_name) || null,
          layoverAfterMin,
          layoverAt: layoverAfterMin != null ? ((s.destination && s.destination.iata_code) || null) : null,
        };
      });

      // Every distinct carrier that actually flies you, for filtering and for display.
      const carriers = Array.from(new Set(segments.map((s) => s.marketingCarrier).filter(Boolean)));

      return {
        price: o.total_amount ? Math.round(parseFloat(o.total_amount)) : null,
        currency: o.total_currency || "USD",
        airline: (o.owner && o.owner.name) || "Airline",
        carriers,                 // all airlines on this itinerary, in leg order
        interline: carriers.length > 1,
        depart: timeOf(first.departing_at),
        depAirport: (first.origin && first.origin.iata_code) || null,
        arrAirport: (last.destination && last.destination.iata_code) || null,
        arrive: timeOf(last.arriving_at),
        stops: segs.length > 0 ? segs.length - 1 : 0,
        totalMin,                 // whole-journey minutes, gate to gate
        airMin: haveAllDur ? airMin : null,
        layoverMin: haveLayovers ? layoverMin : null,
        maxLayoverMin: maxLayover, // worst connection wait
        dayOffset,                // 0 same day, 1 arrives next day, 2 = +2
        flightNo: segments.length ? segments[0].flightNo : null,
        segments,
        offerId: o.id,
      };
    }).filter((o) => o.price != null);

    // Rank by world airline quality (Skytrax 2025/26 order), then reward nonstop so a
    // top-ranked carrier that only offers an absurd detour doesn't beat a great nonstop.
    // NOTE: this is a RECOMMENDATION order, not a price order. The cheapest fare is reported
    // separately and honestly — a field called "cheapest" must be the cheapest.
    const PREFERRED = [
      "Qatar Airways", "Singapore Airlines", "Cathay Pacific", "Emirates", "ANA", "All Nippon",
      "Turkish Airlines", "EVA Air", "Korean Air", "Air France", "Swiss", "Japan Airlines",
      "Hainan", "Lufthansa", "British Airways", "Qantas", "Virgin Atlantic", "KLM",
      "Iberia", "Etihad", "Air Canada", "Finnair", "Austrian", "Brussels", "ITA Airways",
      "Alitalia", "Delta", "United", "American Airlines",
    ];
    const rank = (name) => { const i = PREFERRED.findIndex((p) => (name || "").toLowerCase().includes(p.toLowerCase())); return i === -1 ? 999 : i; };
    // RANKING, 3 SEPT 2026, ON TRICIA'S INSTRUCTION: QUICKEST FIRST, THEN PRICE. Total journey
    // time decides — door to door, layovers included — and among journeys of the same length the
    // lower fare wins. The airline preference list above is kept only as a final tie-break for
    // two journeys of identical time and price, so it can never lift a slower or dearer journey
    // above a faster or cheaper one. Before this the order was airline quality plus a penalty per
    // stop, which put a preferred carrier's slower nonstop ahead of a quicker one. "recommended"
    // is the first journey in this order; "cheapest" is still the cheapest, unchanged.
    const mins = (o) => (Number.isFinite(o.totalMin) && o.totalMin > 0 ? o.totalMin : 1e9);
    const byRank = (a, b) => {
      const dt = mins(a) - mins(b); if (dt !== 0) return dt;
      const dp = (a.price ?? 1e12) - (b.price ?? 1e12); if (dp !== 0) return dp;
      return rank(a.airline) - rank(b.airline);
    };

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
    distinct.sort(byRank);

    // The genuinely cheapest fare in the whole result set. Computed before any narrowing so it
    // never drifts with the filters.
    const trueCheapest = distinct.reduce((lo, o) => (lo == null || o.price < lo.price ? o : lo), null);

    // Who is actually flying this route, with their own lowest fare — enough for the client to
    // build airline filter chips without a second round trip.
    const airlineMap = new Map();
    for (const o of distinct) {
      for (const name of (o.carriers.length ? o.carriers : [o.airline])) {
        const e = airlineMap.get(name) || { airline: name, count: 0, lowest: null, nonstop: 0 };
        e.count += 1;
        if (e.lowest == null || o.price < e.lowest) e.lowest = o.price;
        if (o.stops === 0) e.nonstop += 1;
        airlineMap.set(name, e);
      }
    }
    const airlines = Array.from(airlineMap.values()).sort((a, b) => a.lowest - b.lowest);

    // Optional narrowing, chosen by the traveller. Applied before the airline cap so the
    // spread is drawn from what they actually asked for.
    const wantStops = (req.query.stops || "").toString();       // "0" | "1" | "" (any)
    const wantWhen = (req.query.when || "").toString();          // morning | afternoon | evening
    const hourOf = (hhmm) => (hhmm && /^\d{2}/.test(hhmm) ? parseInt(hhmm.slice(0, 2), 10) : null);
    const inWindow = (o) => {
      const hr = hourOf(o.depart);
      if (hr == null || !wantWhen) return true;
      if (wantWhen === "morning") return hr >= 5 && hr < 12;
      if (wantWhen === "afternoon") return hr >= 12 && hr < 18;
      if (wantWhen === "evening") return hr >= 18 || hr < 5;
      return true;
    };

    let filtered = distinct;
    if (wantStops === "0") filtered = filtered.filter((o) => o.stops === 0);
    else if (wantStops === "1") filtered = filtered.filter((o) => o.stops <= 1);
    if (wantWhen) filtered = filtered.filter(inWindow);
    // If a convenience filter leaves nothing, fall back to everything rather than an empty
    // screen — the traveller expressed a preference, not a requirement.
    const narrowedToNothing = filtered.length === 0 && distinct.length > 0;
    if (narrowedToNothing) filtered = distinct;

    // Airline choice is different: naming an airline IS a requirement. If there is nothing,
    // say so plainly. Quietly showing the carriers they just excluded would be a lie.
    const termList = (s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const wantAirline = termList((req.query.airline || "").toString());
    const notAirline = termList((req.query.exclude || "").toString());
    const namesOf = (o) => [o.airline, ...o.carriers].filter(Boolean).map((x) => x.toLowerCase());
    if (wantAirline.length) {
      filtered = filtered.filter((o) => namesOf(o).some((n) => wantAirline.some((w) => n.includes(w))));
    }
    if (notAirline.length) {
      filtered = filtered.filter((o) => !namesOf(o).some((n) => notAirline.some((w) => n.includes(w))));
    }
    const airlineFilterEmpty = (wantAirline.length > 0 || notAirline.length > 0) && filtered.length === 0;

    // One airline should not fill the page. Cap each carrier so the traveller sees a real
    // choice — a wall of Lufthansa connections is not a choice. But when they have explicitly
    // asked for one airline, show them everything that airline flies.
    const PER_AIRLINE = wantAirline.length ? 99 : 3;
    const count = {};
    const spread = [];
    for (const o of filtered) {
      const a = o.airline || "?";
      count[a] = (count[a] || 0) + 1;
      if (count[a] <= PER_AIRLINE) spread.push(o);
    }

    return res.status(200).json({
      ok: true, from: origin, to: destination, date: dep, cabin: cabinClass,
      resolved,
      // The best journey we'd put in front of a client: the quickest, and at equal time the cheaper.
      recommended: spread[0] || distinct[0] || null,
      // The lowest fare on the route, whatever it is. This field means what it says.
      cheapest: trueCheapest,
      offers: spread.slice(0, 20),
      airlines,
      totalFound: distinct.length,
      nonstopCount: distinct.filter((o) => o.stops === 0).length,
      narrowedToNothing,
      airlineFilterEmpty,
      source: "Duffel",
    });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
