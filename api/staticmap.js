// Voyage One — a real map of the journey, not a schematic.
//
// Takes the trip's coordinates in order and returns an actual Google map image with real
// coastlines and countries, numbered stops, and a line joining them. The key stays here.
//
// Query: ?pts=lat,lng|lat,lng|...  (in travel order)
// Optional: &w=640&h=360
//
// Styled to match the paper/pine/brass palette: muted land, quiet water, no clutter.

const STYLE = [
  // No country or region names — they clutter the picture and label the wrong things
  // (Cuba shouting over Miami). Cities stay, because those are the trip.
  "feature:administrative.country|element:labels|visibility:off",
  "feature:administrative.province|element:labels|visibility:off",
  "feature:administrative.land_parcel|visibility:off",
  "feature:administrative.neighborhood|visibility:off",
  "feature:administrative|element:geometry|visibility:off",
  "feature:administrative.country|element:geometry.stroke|visibility:on|color:0xd9d3c4",
  "feature:administrative.locality|element:labels.text.fill|color:0x6b6257",
  "feature:administrative.locality|element:labels.icon|visibility:off",
  "feature:landscape|element:geometry|color:0xf3efe4",
  "feature:water|element:geometry|color:0xdfe4e0",
  "feature:water|element:labels|visibility:off",
  "feature:poi|visibility:off",
  "feature:road|visibility:off",
  "feature:transit|visibility:off",
];

export default async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return res.status(404).end();

  const raw = (req.query.pts || "").toString().trim();
  if (!raw) return res.status(400).end();

  // Only ever "lat,lng" pairs separated by | — never let this become an open proxy.
  const pairs = raw.split("|").map((s) => s.trim()).filter(Boolean);
  if (!pairs.length || pairs.length > 24) return res.status(400).end();
  for (const p of pairs) {
    if (!/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(p)) return res.status(400).end();
  }

  const w = Math.min(parseInt(req.query.w || "640", 10) || 640, 640);
  const h = Math.min(parseInt(req.query.h || "360", 10) || 360, 640);

  // Google allows exactly one character per marker label. Stops 1-9 are numbered; beyond
  // that we continue with letters rather than dropping the label entirely.
  const labelFor = (i) => (i < 9 ? String(i + 1) : String.fromCharCode(65 + (i - 9)));

  // A trip that starts and ends in the same city would stack two pins on one spot and you
  // would only ever see the top one. Draw such a point once, labelled with its first number.
  const drawn = new Map();
  pairs.forEach((p, i) => { if (!drawn.has(p)) drawn.set(p, labelFor(i)); });

  const params = [
    `size=${w}x${h}`,
    "scale=2",
    "maptype=roadmap",
    ...STYLE.map((s) => `style=${encodeURIComponent(s)}`),
    // The route line, in brass.
    `path=${encodeURIComponent("color:0xA9884Fcc|weight:3|" + pairs.join("|"))}`,
    // Numbered stops in pine, so the order of travel is unmistakable.
    ...Array.from(drawn.entries()).map(([p, lab]) => `markers=${encodeURIComponent(`color:0x20463F|label:${lab}|${p}`)}`),
    `key=${key}`,
  ].join("&");

  const url = `https://maps.googleapis.com/maps/api/staticmap?${params}`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      // Most likely cause: the "Maps Static API" is not enabled on the key. Say so plainly
      // so it is fixable, rather than failing silently.
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "static-maps-error", status: r.status, detail: detail.slice(0, 200) });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/png");
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=2592000");
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
