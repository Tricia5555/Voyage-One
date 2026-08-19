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
// Transit needs the vehicle type too, so we can tell a TRAIN from a Greyhound BUS. Without this
// the endpoint flagged "rail: true" for any transit result at all — and in the US that result is
// almost always an intercity coach, which is not our market and should never surface as "Rail".
const TRANSIT_FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.legs.steps.transitDetails",
  "routes.legs.steps.travelMode",
].join(",");

function minsFrom(d) {
  if (!d) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(d);
  return m ? Math.round(parseFloat(m[1]) / 60) : null;
}

async function route(key, from, to, travelMode, opts, fieldMask) {
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask || FIELD_MASK },
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
    return { minutes: minsFrom(rt.duration), km: rt.distanceMeters ? Math.round(rt.distanceMeters / 1000) : null, data };
  } catch (e) {
    return null;
  }
}

// Pull every named transit vehicle out of a route (RAIL, SUBWAY, BUS, FERRY…), skipping the
// walking legs. Lets us decide whether a "transit" option is a real train/ferry or just a coach.
function transitVehicles(data) {
  const out = [];
  const rt = (data && data.routes || [])[0];
  if (!rt) return out;
  (rt.legs || []).forEach((leg) => {
    (leg.steps || []).forEach((step) => {
      const td = step.transitDetails;
      if (!td) return;
      const line = td.transitLine || {};
      const veh = (line.vehicle && (line.vehicle.type || (line.vehicle.name && line.vehicle.name.text))) || "";
      if (veh) out.push(String(veh));
    });
  });
  return out;
}

const RAIL_RE = /RAIL|TRAIN|SUBWAY|METRO|TRAM|MONORAIL|HEAVY_RAIL|HIGH_SPEED|COMMUTER/i;
const FERRY_RE = /FERRY|BOAT/i;

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
  const O = haveCoords ? { location: { latLng: { latitude: la1, longitude: lo1 } } } : { address: from };
  const D = haveCoords ? { location: { latLng: { latitude: la2, longitude: lo2 } } } : { address: to };

  const [drive, transit, driveNoFerry] = await Promise.all([
    route(key, O, D, "DRIVE"),
    route(key, O, D, "TRANSIT", { computeAlternativeRoutes: false, transitPreferences: { routingPreference: "FEWER_TRANSFERS" } }, TRANSIT_FIELD_MASK),
    // Same drive, forbidding boats. If the ordinary route works but this one does not, the
    // "drive" quietly depends on a car ferry — which the traveller deserves to be told.
    route(key, O, D, "DRIVE", { routeModifiers: { avoidFerries: true } }),
  ]);
  const driveNeedsFerry = !!drive && !driveNoFerry;

  // What kind of transit is it? Only a real train or ferry earns a chip; a bus (Greyhound and
  // the like) never does — it is not the market this app serves.
  const vehicles = transit ? transitVehicles(transit.data) : [];
  const transitIsRail = vehicles.some((v) => RAIL_RE.test(v));
  const transitIsFerry = vehicles.some((v) => FERRY_RE.test(v));

  let verdict = "water";
  if (drive) verdict = drive.minutes != null && drive.minutes > PUNISHING_DRIVE_MIN ? "far" : "land";
  else if (transit) verdict = "land"; // rail or ferry-served even where driving is not offered

  let straightKm = null;
  if (haveCoords) {
    const R = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    straightKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
  const SHORT_WATER_KM = 120;   // a boat ride, not a voyage
  const shortWater = verdict === "water" && straightKm != null && straightKm <= SHORT_WATER_KM;
  const openWater = verdict === "water" && (straightKm == null || straightKm > SHORT_WATER_KM);

  // What the traveller should actually be shown for this leg.
  const modes = {
    // Flight is ALWAYS an option between two cities — the client decides plane vs car, even on a
    // short hop like Birmingham→Atlanta. The old rule hid flying whenever the drive was under
    // three hours, which is exactly the drive-vs-fly bug that kept coming back. The flight panel
    // itself says so honestly when a route genuinely has no bookable fares.
    fly: true,
    drive: !!drive,
    chauffeur: !!drive,
    // Rail only when it is genuinely rail — never a Greyhound/coach masquerading as "transit".
    rail: transitIsRail && verdict !== "water",
    // A ferry belongs on the list for a short crossing, when the only road route puts your car on
    // a boat anyway (mainland Spain to Mallorca), or when Google's transit is itself a ferry.
    ferry: shortWater || driveNeedsFerry || transitIsFerry,
  };

  // Plain-language reason, so the app can explain itself rather than just hiding buttons.
  let note = "";
  if (shortWater) note = `No road connects ${from} and ${to}${straightKm != null ? ` — they are about ${straightKm} km apart across water` : ""}. This leg is a boat.`;
  else if (openWater) note = `No road connects ${from} and ${to} — this leg is over open water, so it is a flight.`;
  else if (driveNeedsFerry) note = `The only road route puts the car on a ferry — about ${Math.round(drive.minutes / 60)} hours all in${drive.km ? ` and ${drive.km} km` : ""}. Flying is usually the sane choice; take the car only if you want it once you arrive.`;
  else if (verdict === "far") note = `Driving is about ${Math.round(drive.minutes / 60)} hours${drive.km ? ` and ${drive.km} km` : ""} — a flight will win back most of a day.`;
  else if (drive && drive.minutes <= COMFORTABLE_DRIVE_MIN) note = `About ${Math.round(drive.minutes / 60 * 10) / 10} hours by road${drive.km ? ` (${drive.km} km)` : ""} — comfortably driveable, and quicker door to door than flying.`;
  else if (drive) note = `About ${Math.round(drive.minutes / 60)} hours by road${drive.km ? ` (${drive.km} km)` : ""}.`;

  // Return trimmed drive/transit (no raw Google payload — the app only needs minutes/km).
  const driveOut = drive ? { minutes: drive.minutes, km: drive.km } : null;
  const transitOut = transit ? { minutes: transit.minutes, km: transit.km, isRail: transitIsRail, isFerry: transitIsFerry } : null;
  res.setHeader("Cache-Control", "s-maxage=2592000, stale-while-revalidate=31536000");
  return res.status(200).json({ ok: true, from, to, verdict, drive: driveOut, transit: transitOut, modes, note });
}
