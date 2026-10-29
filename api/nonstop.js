// Voyage One — "is there a nonstop?" from published airline schedules (FlightAware AeroAPI).
//
// Why schedules and not fares: Duffel cannot see Delta, and from Atlanta nearly every Caribbean
// nonstop IS Delta — so the ideas screen said "0 of 16 have a nonstop" to the whole Caribbean.
// Amadeus's self-service API, the obvious fare source, was decommissioned on 17 July 2026. The
// question the ideas screen asks is a schedule question — who flies it, what time — and the
// airlines' published schedules answer it for every carrier. Fares come from Duffel today and
// Sabre when it arrives. Added 29 Oct 2026 (M1017). M1018: the live answer carried no carrier
// field, only "DL1944" — so the airline is read from the flight number when the field is missing.
//
// Runs on Vercel with AEROAPI_KEY (never in the browser).
//
// Query params:
//   from, to   IATA codes, or "City (CODE)" — the app sends codes from its own airport table
//   date       YYYY-MM-DD (local departure day)
//
// Answer: { ok, from, to, date, nonstop: true|false, count, flights: [{ airline, code, flightNo,
//           depart, arrive, minutes, aircraft }], source: "FlightAware" }
//   flights is the nonstop list for that day, earliest departure first, one row per operated
//   flight (codeshares collapse onto the airline actually flying).

const HOST = "https://aeroapi.flightaware.com/aeroapi";
const AIRLINES = {
  DL: "Delta", AA: "American Airlines", UA: "United", B6: "JetBlue", WN: "Southwest", AS: "Alaska Airlines",
  NK: "Spirit", F9: "Frontier", HA: "Hawaiian Airlines", AC: "Air Canada", WS: "WestJet", BA: "British Airways",
  VS: "Virgin Atlantic", LH: "Lufthansa", AF: "Air France", KL: "KLM", IB: "Iberia", LX: "Swiss", OS: "Austrian",
  EK: "Emirates", QR: "Qatar Airways", EY: "Etihad", TK: "Turkish Airlines", SQ: "Singapore Airlines", CX: "Cathay Pacific",
  JL: "Japan Airlines", NH: "ANA", QF: "Qantas", NZ: "Air New Zealand", AZ: "ITA Airways", TP: "TAP Air Portugal", EI: "Aer Lingus",
  AM: "Aeromexico", LA: "LATAM", CM: "Copa", AV: "Avianca", BW: "Caribbean Airlines", KX: "Cayman Airways", UP: "Bahamasair",
  JY: "interCaribbean", "3M": "Silver Airways", FI: "Icelandair", SK: "SAS", AY: "Finnair", ET: "Ethiopian", KQ: "Kenya Airways",
  SA: "South African", MS: "EgyptAir", RJ: "Royal Jordanian", SV: "Saudia", GF: "Gulf Air", WY: "Oman Air", MH: "Malaysia Airlines",
  TG: "Thai Airways", GA: "Garuda", VN: "Vietnam Airlines", PR: "Philippine Airlines", KE: "Korean Air", OZ: "Asiana", CI: "China Airlines",
  BR: "EVA Air", CA: "Air China", MU: "China Eastern", CZ: "China Southern", AI: "Air India", UL: "SriLankan", FJ: "Fiji Airways", TN: "Air Tahiti Nui",
};

function codeOf(s) {
  const t = String(s || "").trim();
  const m = /\(([A-Z]{3})\)\s*$/.exec(t);
  if (m) return m[1];
  return /^[A-Za-z]{3}$/.test(t) ? t.toUpperCase() : null;
}
const timeOf = (iso) => { const m = /T(\d{2}:\d{2})/.exec(iso || ""); return m ? m[1] : null; };
const nextDay = (d) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };

export default async function handler(req, res) {
  const key = process.env.AEROAPI_KEY;
  const from = codeOf(req.query.from), to = codeOf(req.query.to);
  const date = String(req.query.date || "").trim();

  if (!key) return res.status(200).json({ ok: false, reason: "no-token" });
  if (!from || !to) return res.status(200).json({ ok: false, reason: "need-codes", from: req.query.from, to: req.query.to });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(200).json({ ok: false, reason: "need-date" });

  try {
    // Schedules are keyed on UTC; ask for the day and the next and keep flights whose LOCAL
    // departure date (scheduled_out carries the zone offset) is the day asked for.
    const url = `${HOST}/schedules/${date}/${nextDay(date)}?origin=${from}&destination=${to}&max_pages=3`;
    const r = await fetch(url, { headers: { "x-apikey": key, "Accept": "application/json" } });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "aeroapi-error", status: r.status, detail: detail.slice(0, 300) });
    }
    const j = await r.json();
    const seen = new Map();
    for (const f of (j.scheduled || [])) {
      if (f.actual_ident) continue;                       // a codeshare: the operating flight is listed on its own
      const out = f.scheduled_out || "", inn = f.scheduled_in || "";
      const localDay = (() => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})[^Z+-]*([+-]\d{2}:\d{2}|Z)?/.exec(out); if (!m) return null;
        if (!m[3] || m[3] === "Z") return m[1]; const t = new Date(out); if (isNaN(t)) return m[1];
        const sign = m[3][0] === "-" ? -1 : 1; const off = sign * (parseInt(m[3].slice(1, 3)) * 60 + parseInt(m[3].slice(4, 6)));
        return new Date(t.getTime() + off * 60000).toISOString().slice(0, 10); })();
      if (localDay && localDay !== date) continue;
      const flightNo = f.ident_iata || f.ident || `${f.operator_iata || ""}${f.flight_number || ""}`;
      const fromNo = (/^([A-Z0-9]{2})\d/.exec(String(flightNo).toUpperCase()) || [])[1] || "";
      const code = (f.operator_iata || fromNo || f.operator || "").toUpperCase();
      const k = `${flightNo}|${out}`;
      if (seen.has(k)) continue;
      const mins = (out && inn) ? Math.round((new Date(inn) - new Date(out)) / 60000) : null;
      seen.set(k, {
        airline: AIRLINES[code] || code, code, flightNo,
        depart: timeOf(out), arrive: timeOf(inn), minutes: Number.isFinite(mins) && mins > 0 ? mins : null,
        aircraft: f.aircraft_type || null,
      });
    }
    const flights = Array.from(seen.values()).sort((a, b) => String(a.depart || "").localeCompare(String(b.depart || "")));
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json({ ok: true, from, to, date, nonstop: flights.length > 0, count: flights.length, flights, source: "FlightAware" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
