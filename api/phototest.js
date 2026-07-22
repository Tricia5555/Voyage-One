// Voyage One — one-shot photo diagnostic. Visit /api/phototest and it runs the whole
// city-photo chain server-side for Paris and reports, in plain words, exactly where it
// breaks (or shows the final image). No copy-paste needed.

export default async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_KEY;
  const steps = [];
  const done = (obj) => res.status(200).json({ ...obj, steps });

  if (!key) return done({ ok: false, where: "no GOOGLE_PLACES_KEY on the server" });
  steps.push("1. Google key is present.");

  let photoName = null;
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.photos,places.displayName",
      },
      body: JSON.stringify({ textQuery: "Paris famous landmark", maxResultCount: 5 }),
    });
    steps.push(`2. searchText responded HTTP ${r.status}.`);
    if (!r.ok) {
      const detail = await r.text();
      return done({ ok: false, where: "the searchText call failed", detail: detail.slice(0, 300) });
    }
    const data = await r.json();
    const places = data.places || [];
    steps.push(`3. searchText returned ${places.length} place(s).`);
    for (const p of places) {
      if (p.photos && p.photos[0] && p.photos[0].name) { photoName = p.photos[0].name; break; }
    }
    if (!photoName) return done({ ok: false, where: "no place in the results had a photo" });
    steps.push(`4. Got a photo name (length ${photoName.length}).`);
  } catch (e) {
    return done({ ok: false, where: "searchText threw an error", detail: String(e).slice(0, 300) });
  }

  // Now fetch the actual media URL from Google, exactly like /api/photo does.
  try {
    const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=600&skipHttpRedirect=true&key=${key}`;
    const r = await fetch(mediaUrl);
    steps.push(`5. media call responded HTTP ${r.status}.`);
    if (!r.ok) {
      const detail = await r.text();
      return done({ ok: false, where: "the media call failed (this is likely the whole bug)", detail: detail.slice(0, 300) });
    }
    const j = await r.json();
    if (!j.photoUri) return done({ ok: false, where: "media call succeeded but returned no photoUri", got: Object.keys(j) });
    steps.push("6. Got a real photoUri from Google.");
    // If ?show=1, redirect straight to the image so you SEE it.
    if (req.query.show) return res.redirect(302, j.photoUri);
    return done({ ok: true, where: "everything works — the photo chain is fine", photoUri: j.photoUri.slice(0, 80) + "..." });
  } catch (e) {
    return done({ ok: false, where: "media call threw an error", detail: String(e).slice(0, 300) });
  }
}
