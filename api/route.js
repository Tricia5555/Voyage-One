// Voyage One — real routing, from Google.
//
// Runs on Vercel's servers with the same GOOGLE_PLACES_KEY, never in the browser.
// Answers the one question that made the old app lie: "how do I actually get from A to B,
// and is there a train?" It returns REAL named stations, real line names, real times —
// or nothing. It never invents a route. If Google has no transit for a pair, we say so
// honestly rather than fabricating a European train under a South American city.
//
// Requires the "Routes API" to be enabled in the same Google Cloud project as Places.

const FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.legs.steps.transitDetails",
  "routes.legs.steps.travelMode",
  "routes.travelAdvisory",
].join(",");

function minsFromDuration(d) {
  // Google returns duration like "5400s"
  if (!d) return null;
  const m = /^(\d+)s$/.exec(d);
  return m ? Math.round(parseInt(m[1], 10) / 60) : null;
}
function label(mins) {
  if (mins == null) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h} hr${m ? " " + m + " min" : ""}` : `${m} min`;
}

async function computeRoute(key, origin, destination, mode, extra) {
  const body = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: mode,
    ...extra,
  };
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { ok: false, status: r.status, detail: detail.slice(0, 300) };
  }
  const data = await r.json();
  return { ok: true, data };
}

export default async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_KEY;
  const origin = (req.query.from || "").toString().trim();
  const destination = (req.query.to || "").toString().trim();

  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  if (!origin || !destination) return res.status(200).json({ ok: false, reason: "no-cities" });

  try {
    const modes = [];

    // 1) Transit — trains, buses, ferries — with real station and line names.
    const transit = await computeRoute(key, origin, destination, "TRANSIT", {
      computeAlternativeRoutes: false,
      transitPreferences: { routingPreference: "FEWER_TRANSFERS" },
    });
    if (transit.ok && transit.data.routes && transit.data.routes[0]) {
      const route = transit.data.routes[0];
      const mins = minsFromDuration(route.duration);
      // Pull the named vehicle legs (the train/bus/ferry parts, not the walking).
      const legs = [];
      (route.legs || []).forEach((leg) => {
        (leg.steps || []).forEach((step) => {
          const td = step.transitDetails;
          if (!td) return;
          const line = td.transitLine || {};
          const veh = (line.vehicle && (line.vehicle.type || line.vehicle.name && line.vehicle.name.text)) || "";
          legs.push({
            vehicle: veh,
            line: (line.nameShort || line.name || "") + "",
            agency: (line.agencies && line.agencies[0] && line.agencies[0].name) || "",
            from: td.stopDetails && td.stopDetails.departureStop && td.stopDetails.departureStop.name || "",
            to: td.stopDetails && td.stopDetails.arrivalStop && td.stopDetails.arrivalStop.name || "",
            depart: td.localizedValues && td.localizedValues.departureTime && td.localizedValues.departureTime.time && td.localizedValues.departureTime.time.text || "",
            arrive: td.localizedValues && td.localizedValues.arrivalTime && td.localizedValues.arrivalTime.time && td.localizedValues.arrivalTime.time.text || "",
          });
        });
      });
      if (legs.length) {
        // Name the primary vehicle for a quick summary (the longest-named leg).
        const primary = legs.find((l) => /RAIL|TRAIN|SUBWAY|METRO|FERRY|HEAVY_RAIL|HIGH_SPEED/i.test(l.vehicle)) || legs[0];
        modes.push({
          mode: "Transit",
          vehicle: primary.vehicle,
          mins,
          label: label(mins),
          summary: legs.map((l) => l.line || l.vehicle).filter(Boolean).join(" → "),
          legs,
        });
      }
    }

    // 2) Driving — real road time, globally.
    const drive = await computeRoute(key, origin, destination, "DRIVE", {
      routingPreference: "TRAFFIC_UNAWARE",
    });
    if (drive.ok && drive.data.routes && drive.data.routes[0]) {
      const route = drive.data.routes[0];
      const mins = minsFromDuration(route.duration);
      const km = route.distanceMeters ? Math.round(route.distanceMeters / 1000) : null;
      if (mins != null) modes.push({ mode: "Drive", mins, label: label(mins), km });
    }

    if (!modes.length) {
      // Google knows the places but offers no ground route — usually a sea crossing or
      // a distance only flyable. Honest empty, never invented.
      return res.status(200).json({ ok: true, from: origin, to: destination, modes: [], note: "no-ground-route" });
    }

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ ok: true, from: origin, to: destination, modes, attribution: "Powered by Google" });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
