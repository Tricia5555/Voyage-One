// Voyage One — genuinely city-specific "don't miss" notes, written fresh for each place.
//
// The hand-typed insider list only ever covered a handful of cities; everywhere else fell
// back to a generic checklist. This asks Claude for a few precise, tasteful suggestions for
// ANY city, so the notes finally fit the destination. Answers are cached hard — a city's
// highlights don't change day to day — so the cost is a few pennies, once, per city.
//
// Needs an ANTHROPIC_API_KEY in the environment, set in Vercel exactly like the Google and
// Duffel keys. WITHOUT it, this returns nothing and the app quietly falls back to its
// existing notes — so it is completely safe to deploy before the key is added.

// Haiku is fast and inexpensive and more than good enough here. Swap to a Sonnet string for
// richer prose if you'd rather — the shape of the response is identical.
const MODEL = "claude-haiku-4-5-20251001";

export default async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  const city = (req.query.city || "").toString().replace(/\s*\([A-Z]{3}\)\s*$/, "").trim();
  if (!city) return res.status(200).json({ ok: false, reason: "no-city" });
  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });

  const prompt = `You are a discerning private travel advisor writing notes for a well-travelled client heading to ${city}.

Give exactly 3 "don't miss" suggestions that are SPECIFIC to ${city} — named places, dishes, viewpoints, timings or experiences that only apply here. Absolutely no generic filler ("try the local cuisine", "wander the old town", "soak up the atmosphere"). Think like an insider who knows the city well: the table worth booking, the view at the right hour, the small museum the crowds skip, the neighbourhood locals actually go to, the thing that would make a seasoned traveller nod.

Each suggestion needs a short title (2 to 5 words) and one or two sentences of warm, precise detail. Tasteful and understated, never breathless. No exclamation marks.

Return ONLY a JSON array, with no preamble and no markdown code fences, in exactly this shape:
[{"title":"...","note":"..."},{"title":"...","note":"..."},{"title":"...","note":"..."}]`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({ ok: false, reason: "anthropic-error", status: r.status, detail: detail.slice(0, 200) });
    }
    const data = await r.json();
    const text = (data.content || []).map((b) => b.text || "").join("").trim();
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    let items = [];
    try { items = JSON.parse(clean); } catch (e) {
      return res.status(200).json({ ok: false, reason: "parse", raw: clean.slice(0, 160) });
    }
    if (!Array.isArray(items)) return res.status(200).json({ ok: false, reason: "shape" });
    const cleaned = items
      .filter((x) => x && x.title && x.note)
      .slice(0, 3)
      .map((x) => ({ title: String(x.title).slice(0, 80), note: String(x.note).slice(0, 400) }));
    if (!cleaned.length) return res.status(200).json({ ok: false, reason: "empty" });

    // Cache for a month at the edge; these are stable.
    res.setHeader("Cache-Control", "s-maxage=2592000, stale-while-revalidate=31536000");
    return res.status(200).json({ ok: true, city, items: cleaned });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200) });
  }
}
