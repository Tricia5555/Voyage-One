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

async function route(key, from, to, travelMode, opts) {
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify({
        origin: from,
        destination: to,
        travelMode,
        ...(travelMode === "DRIVE" ? { routingPreference: "TRAFFIC_UNAWARE" } : {}),
        ...(opts || {}),
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

  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const la1 = num(req.query.flat), lo1 = num(req.query.flng), la2 = num(req.query.tlat), lo2 = num(req.query.tlng);
  const haveCoords = la1 != null && lo1 != null && la2 != null && lo2 != null;

  // Coordinates beat names every time: "Birmingham" is two cities, but 33.56,-86.75 is one
  // place. When the app knows where it means, we route on that and nothing is ambiguous.
  //
  // And when it does NOT know, we stop. The fallback used to hand the bare name to Google,
  // which answered confidently and often wrongly: "Birmingham" became England, and a leg
  // from Alabama to Milan came back as a sixteen-hour drive. A wrong answer delivered with
  // certainty is worse than no answer, so an unresolved endpoint now returns nothing to say.
  // Universal: it is a rule about missing coordinates, not about any particular city.
  if (!haveCoords) {
    return res.status(200).json({
      ok: true, from, to, verdict: "unknown", drive: null, transit: null,
      modes: { fly: true, drive: false, chauffeur: false, rail: false, ferry: false }, note: "",
    });
  }

  const O = { location: { latLng: { latitude: la1, longitude: lo1 } } };
  const D = { location: { latLng: { latitude: la2, longitude: lo2 } } };

  const [drive, transit, driveNoFerry] = await Promise.all([
    route(key, O, D, "DRIVE"),
    route(key, O, D, "TRANSIT"),
    // Same drive, forbidding boats. If the ordinary route works but this one does not, the
    // "drive" quietly depends on a car ferry — which the traveller deserves to be told.
    route(key, O, D, "DRIVE", { routeModifiers: { avoidFerries: true } }),
  ]);
  const driveNeedsFerry = !!drive && !driveNoFerry;

  let verdict = "water";
  if (drive) verdict = drive.minutes != null && drive.minutes > PUNISHING_DRIVE_MIN ? "far" : "land";
  else if (transit) verdict = "land"; // rail or ferry-served even where driving is not offered

  const R = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
  const hav = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  const straightKm = Math.round(R * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav)));

  const SHORT_WATER_KM = 120;   // a boat ride, not a voyage
  // Past this, nobody was ever going to drive it, so explaining that there is no road is
  // noise at best and faintly absurd at worst — "no road connects Birmingham and Milan" is
  // true and useless. Under it, the note earns its place: Barcelona to Mallorca or Naples to
  // Capri are legs where a traveller genuinely wonders whether the car can come.
  const NO_ROAD_EXPLAIN_KM = 1000;
  const shortWater = verdict === "water" && straightKm <= SHORT_WATER_KM;
  const openWater = verdict === "water" && straightKm > SHORT_WATER_KM;
  const worthExplaining = straightKm <= NO_ROAD_EXPLAIN_KM;

  // What the traveller should actually be shown for this leg.
  const modes = {
    fly: openWater || (verdict === "far") || (!!drive && drive.minutes > COMFORTABLE_DRIVE_MIN),
    drive: !!drive,
    chauffeur: !!drive,
    rail: !!transit && verdict !== "water",
    // A ferry belongs on the list for a short crossing, and also when the only road route
    // puts your car on a boat anyway (mainland Spain to Mallorca, say).
    ferry: shortWater || driveNeedsFerry,
  };

  // Plain-language reason, so the app can explain itself rather than just hiding buttons.
  let note = "";
  if (shortWater) note = `No road connects ${from} and ${to} — they are about ${straightKm} km apart across water. This leg is a boat.`;
  else if (openWater) note = worthExplaining ? `No road connects ${from} and ${to} — this leg is over open water, so it is a flight.` : "";
  else if (driveNeedsFerry) note = `The only road route puts the car on a ferry — about ${Math.round(drive.minutes / 60)} hours all in${drive.km ? ` and ${drive.km} km` : ""}. Flying is usually the sane choice; take the car only if you want it once you arrive.`;
  else if (verdict === "far") note = `Driving is about ${Math.round(drive.minutes / 60)} hours${drive.km ? ` and ${drive.km} km` : ""} — a flight will win back most of a day.`;
  else if (drive && drive.minutes <= COMFORTABLE_DRIVE_MIN) note = `About ${Math.round(drive.minutes / 60 * 10) / 10} hours by road${drive.km ? ` (${drive.km} km)` : ""} — comfortably driveable, and quicker door to door than flying.`;
  else if (drive) note = `About ${Math.round(drive.minutes / 60)} hours by road${drive.km ? ` (${drive.km} km)` : ""}.`;

  res.setHeader("Cache-Control", "s-maxage=2592000, stale-while-revalidate=31536000");
  return res.status(200).json({ ok: true, from, to, verdict, drive, transit, modes, note });
}
