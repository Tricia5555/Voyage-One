// Voyage One — Help.
//
// Answers a question about how the site works. It is allowed to know ONE thing: the written
// guide the app sends with the question, plus which screen the person is on. It cannot invent a
// feature we do not have, because it only knows the ones in the guide — and it is told to say
// so when the guide does not cover something, rather than guess.
//
// POST /api/help  with JSON body: { question, where, guide: [{ id, title, text }] }
// Returns: { ok: true, answer }
//
// Needs ANTHROPIC_API_KEY in the environment, like insider.js. Without it the app searches the
// guide itself for the best-matching section, so this is safe to deploy before the key.

const MODEL = "claude-haiku-4-5-20251001";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: false, reason: "post-only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !body.question || !Array.isArray(body.guide) || !body.guide.length) return res.status(200).json({ ok: false, reason: "bad-request" });
  const question = String(body.question).slice(0, 600);
  const where = String(body.where || "the site").slice(0, 80);
  const guide = body.guide.map((g) => `## ${g.title}\n${g.text}`).join("\n\n");

  const prompt = `You are the help desk for Voyage One, a private luxury travel-planning site. A client is on ${where} and has asked a question about how the site works.

THE GUIDE — this is everything you know about the site. Treat it as the only truth. If the answer is not in it, say plainly that the guide does not cover it and suggest the nearest section; never guess at a feature, a button or a name that is not written here.

${guide}

THE QUESTION
${question}

Answer in two to five sentences, warm and precise, naming the exact button or row the person should look for, in the capitals the guide uses (BOOKED / NOT BOOKED, SEND AS PDF). If the person is already on the screen where the answer lives, say so and tell them where to look on it. No exclamation marks, no bullet points, no preamble. Return only the answer text.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) { const detail = await r.text(); return res.status(200).json({ ok: false, reason: "anthropic-error", status: r.status, detail: detail.slice(0, 200) }); }
    const data = await r.json();
    const text = (data.content || []).map((b) => b.text || "").join("").trim();
    if (!text) return res.status(200).json({ ok: false, reason: "empty" });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, answer: text.slice(0, 1200) });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "fetch", detail: String(e && e.message || e).slice(0, 200) });
  }
}
