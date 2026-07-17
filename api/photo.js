// Voyage One — photo proxy.
//
// Google's photo URLs need the API key. If we put those URLs in an <img src>, the key is
// in the page source and it is gone. So the browser asks us, we ask Google with the key,
// and we hand back the image address Google gives us. The key stays here.
//
// These are the hotels' and restaurants' own photographs, licensed for display through
// the Places terms — not scraped, and not stock images pretending to be the place.

export default async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_KEY;
  const name = (req.query.name || "").toString();
  const h = Math.min(parseInt(req.query.h || "400", 10) || 400, 1200);

  if (!key) return res.status(404).end();
  // Only ever a Places photo resource. Do not let this become an open redirect.
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_\-.]+$/.test(name)) return res.status(400).end();

  try {
    const url = `https://places.googleapis.com/v1/${name}/media?maxHeightPx=${h}&skipHttpRedirect=true&key=${key}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(404).end();
    const j = await r.json();
    if (!j.photoUri) return res.status(404).end();
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.redirect(302, j.photoUri);
  } catch (e) {
    return res.status(404).end();
  }
}
