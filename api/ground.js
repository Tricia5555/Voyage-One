// Voyage One — is there actually a way to get there over land?
//
// This replaces a hand-typed table of drive times and ferries that only ever knew the city
// pairs I had thought of. It asks Google the same two questions for any two places on earth:
// can you drive it, and can you do it on public transport? From those answers the app can
// stop offering a hire car to an island or a train across an ocean.
//
// Verdicts:
//   land      — a road connects them; drive/rail/chauffeur are real options
//   water     — no road at all; this is a ferry or a flight, never a car
//   far       — a road exists but it is a punishing distance; flying is the sane choice
//
// Requires the Routes API, already enabled alongside Places.

const FIELD_MASK = ["routes.duration", "routes.distanceMeters"].join(",");

function minsFrom(d) {
  if (!d) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(d);
  return m ? Math.round(parseFloat(m[1]) / 60) : null;
}

async function route(key, from, to, travelMode) {
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify({
        origin: { address: from },
        destination: { address: to },
        travelMode,
        ...(travelMode === "DRIVE" ? { routingPreference: "TRAFFIC_UNAWARE" } : {}),
      }),
    });
    if (!r.ok) return null;                      // no route of this kind
    const data = await r.json();
    const rt = (data.routes || [])[0];
    if (!rt) return null;
    return { minutes: minsFrom(rt.duration), km: rt.distanceMeters ? Math.round(rt.distanceMeters / 1000) : null };
  } catch (e) {
    return null;
  }
}

// Roughly three hours behind the wheel is where a short flight starts winning once you
// count airports; past about eight hours, driving is a different holiday altogether.
const COMFORTABLE_DRIVE_MIN = 180;
const PUNISHING_DRIVE_MIN = 480;

export default async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_KEY;
  const from = (req.query.from || "").toString().trim();
  const to = (req.query.to || "").toString().trim();
  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  if (!from || !to) return res.status(200).json({ ok: false, reason: "need-both" });

  const [drive, transit] = await Promise.all([
    route(key, from, to, "DRIVE"),
    route(key, from, to, "TRANSIT"),
  ]);

  let verdict = "water";
  if (drive) verdict = drive.minutes != null && drive.minutes > PUNISHING_DRIVE_MIN ? "far" : "land";
  else if (transit) verdict = "land"; // rail or ferry-served even where driving is not offered

  // When there is no road, distance decides what kind of water this is. A short hop is a
  // ferry (Positano to Capri); an ocean is a flight (Tokyo to Hong Kong). Without this a
  // ferry gets offered across the Pacific and a flight gets offered to an island with no
  // airport. Coordinates are optional — the app sends them when it has them.
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const la1 = num(req.query.flat), lo1 = num(req.query.flng), la2 = num(req.query.tlat), lo2 = num(req.query.tlng);
  let straightKm = null;
  if (la1 != null && lo1 != null && la2 != null && lo2 != null) {
    const R = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    straightKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
  const SHORT_WATER_KM = 120;   // a boat ride, not a voyage
  const shortWater = verdict === "water" && straightKm != null && straightKm <= SHORT_WATER_KM;
  const openWater = verdict === "water" && (straightKm == null || straightKm > SHORT_WATER_KM);

  // What the traveller should actually be shown for this leg.
  const modes = {
    fly: openWater || (verdict === "far") || (!!drive && drive.minutes > COMFORTABLE_DRIVE_MIN),
    drive: !!drive,
    chauffeur: !!drive,
    rail: !!transit && verdict !== "water",
    ferry: shortWater,
  };

  // Plain-language reason, so the app can explain itself rather than just hiding buttons.
  let note = "";
  if (shortWater) note = `No road connects ${from} and ${to}${straightKm != null ? ` — they are about ${straightKm} km apart across water` : ""}. This leg is a boat.`;
  else if (openWater) note = `No road connects ${from} and ${to} — this leg is over open water, so it is a flight.`;
  else if (verdict === "far") note = `Driving is about ${Math.round(drive.minutes / 60)} hours${drive.km ? ` and ${drive.km} km` : ""} — a flight will win back most of a day.`;
  else if (drive && drive.minutes <= COMFORTABLE_DRIVE_MIN) note = `About ${Math.round(drive.minutes / 60 * 10) / 10} hours by road${drive.km ? ` (${drive.km} km)` : ""} — comfortably driveable, and quicker door to door than flying.`;
  else if (drive) note = `About ${Math.round(drive.minutes / 60)} hours by road${drive.km ? ` (${drive.km} km)` : ""}.`;

  res.setHeader("Cache-Control", "s-maxage=2592000, stale-while-revalidate=31536000");
  return res.status(200).json({ ok: true, from, to, verdict, drive, transit, modes, note });
}
