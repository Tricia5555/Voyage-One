// Voyage One — "I Know Where but Not How".
//
// The client knows the country or the coast and nothing else. The app has asked its universal
// questions and gathered everything Voyage One carries for that region: the destinations, the
// hotels with their tiers, what each place is for, and the distances between them. This file
// does two things, both under ONE HARD RULE — it may only use what is in the inventory it is
// given. No hotel, town or restaurant that Voyage One has not vetted may appear in any answer.
//
//   mode "questions"  →  zero to three destination-specific questions, each asked ONLY if the
//                        answer could materially change the itinerary. Usually zero or one.
//   (default)         →  the shaped trip: legs, nights, a hotel at each, why, and one sentence
//                        of logic explaining the shape.
//
// POST /api/guide  with JSON body:
//   { mode?, answers, extraQuestions?, region, getting, inventory: [...], distances: [...] }
//
// Needs ANTHROPIC_API_KEY in the environment, like insider.js. Without it, returns ok:false and
// the app falls back to its own rules-based build, so this is safe to deploy before the key.

const MODEL = "claude-sonnet-4-6";

const FEEL = { relaxed: "relaxed", romantic: "romantic", active: "active", cultural: "cultural", foodwine: "food and wine", glamorous: "glamorous and social", adventure: "adventure", wellness: "wellness", family: "family time", celebration: "a celebration", everything: "a little of everything" };
const PACE = { veryrelaxed: "very relaxed", slow: "relaxed", between: "balanced", busy: "busy", full: "see as much as possible" };
const MOVE = { base: "one excellent base", two: "two or three bases", journey: "comfortable moving several times — a journey through the region" };
const TRANSFERS = { drive: "happy to drive and wants to SEE the country between places", short: "wants every transfer kept under about two hours", none: "does not want long drives at all — fly or boat between places" };
const HOTEL = { walkable: "a walkable location", water: "waterfront", resort: "a resort setting", historic: "historic character", design: "contemporary design", privacy: "privacy", spa: "spa and wellness", best: "the best overall, whatever the setting" };

function clientBlock(answers) {
  return `THE CLIENT
- Nights: ${answers.nights}
- When: ${answers.when || "not fixed"}
- Wants the trip to feel: ${(answers.feel || []).map((x) => FEEL[x] || x).join(", ") || "not stated"}
- What draws them here: ${(answers.draws || []).join(", ") || "not stated"}
- Pace: ${PACE[answers.pace] || answers.pace || "not stated"}
- Changing hotels: ${MOVE[answers.move] || answers.move || "not stated"}
- Transfers: ${TRANSFERS[answers.transfers] || "not stated"}
- In a hotel, what matters most: ${(answers.hotel || []).map((x) => HOTEL[x] || x).join(", ") || "not stated"}
- Must do: ${answers.must || "nothing stated"}
- Must NOT do: ${answers.avoid || "nothing stated"}
- Tier: ${answers.tier === "UltraLux" ? "Ultra Luxury — the very top of what we carry" : "Luxury"}${answers.extra && Object.keys(answers.extra).length ? `\n- Answers to this region's own questions:\n${Object.entries(answers.extra).map(([q, v]) => `    Q: ${q}\n    A: ${v}`).join("\n")}` : ""}`;
}

function inventoryBlock(region, getting, inventory, distances) {
  const inv = inventory.map((d) => {
    const hotels = (d.hotels || []).map((h) => `    - ${h.name} [${h.tier}]${h.area ? ` — ${h.area}` : ""}${h.take ? ` — ${h.take}` : ""}`).join("\n");
    return `  ${d.city}${d.gateway ? ` (fly into ${d.gateway})` : ""}${d.far ? " — FAR from the rest of the region; include only on a long trip" : ""}${d.facets && d.facets.length ? ` — known for: ${d.facets.join(", ")}` : ""}${d.pitch ? `\n    Why go: ${d.pitch}` : ""}\n${hotels || "    (no hotels carried)"}`;
  }).join("\n");
  const dist = (distances || []).length ? `\nDISTANCES BETWEEN THEM (straight line; road is longer)\n${distances.map((x) => `  ${x.from} — ${x.to}: ${x.km} km${x.drive ? `, about ${x.drive} by road` : ""}`).join("\n")}` : "";
  return `HOW ${region.toUpperCase()} IS TRAVELLED\n${getting || "(not stated)"}\n\nWHAT VOYAGE ONE CARRIES IN ${region.toUpperCase()} — THIS IS THE ONLY INVENTORY YOU MAY USE\n${inv}${dist}`;
}

async function ask(key, prompt, maxTokens) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) { const detail = await r.text(); return { error: { reason: "anthropic-error", status: r.status, detail: detail.slice(0, 200) } }; }
  const data = await r.json();
  const text = (data.content || []).map((b) => b.text || "").join("").trim();
  const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
  try { return { json: JSON.parse(clean) }; } catch (e) { return { error: { reason: "parse", raw: clean.slice(0, 200) } }; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: false, reason: "post-only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: "no-key" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !body.answers || !body.region || !Array.isArray(body.inventory) || !body.inventory.length) {
    return res.status(200).json({ ok: false, reason: "bad-request" });
  }
  const { answers, region, inventory, distances, getting } = body;
  res.setHeader("Cache-Control", "no-store");

  // ── MODE: QUESTIONS ─────────────────────────────────────────────────────────────────────────
  if (body.mode === "questions") {
    const prompt = `You are a discerning private travel advisor at Voyage One. A client wants to go to ${region} and has answered our universal questions. Decide whether anything specific to ${region} still needs asking before you shape the trip.

${clientBlock(answers)}

${inventoryBlock(region, getting, inventory, distances)}

THE TEST for every question: "Could the answer materially change which places are included, how many nights each gets, the order, or the hotel?" If not, do not ask it. Most clients need ZERO or ONE further question. Never more than three. Never ask what the universal answers already settle. Never ask about private drivers or transfers — the hotels arrange those. Never ask something that does not apply to the season they are travelling. Each question offers two to four short options; the last option may be "Choose for me".

Examples of the kind of question that passes: "Is Dubrovnik a must, or would you rather more time on the islands?" — "Would you like the Sahara to be part of this?" — "How strenuous would you like the walking to be?" Only ask them if THIS client's answers leave them open.

Return ONLY a JSON object, no preamble, no markdown fences: {"questions":[{"q":"...","options":["...","..."]}]} — and {"questions":[]} if nothing needs asking.`;
    const out = await ask(key, prompt, 600);
    if (out.error) return res.status(200).json({ ok: false, ...out.error });
    const qs = (out.json && Array.isArray(out.json.questions) ? out.json.questions : []).filter((x) => x && x.q && Array.isArray(x.options) && x.options.length >= 2).slice(0, 3)
      .map((x) => ({ q: String(x.q).slice(0, 200), options: x.options.slice(0, 4).map((o) => String(o).slice(0, 60)) }));
    return res.status(200).json({ ok: true, questions: qs });
  }

  // ── MODE: THE TRIP ──────────────────────────────────────────────────────────────────────────
  const prompt = `You are a discerning private travel advisor at Voyage One, a luxury travel atelier. A client wants to go to ${region} and knows almost nothing about it. Shape the trip for them.

${clientBlock(answers)}

${inventoryBlock(region, getting, inventory, distances)}

THE RULES
1. Use ONLY the destinations and hotels listed above. Never name a hotel, town, restaurant or lodge that is not in the list. If the inventory cannot support something the client asked for, leave it out and say so in the tips.
2. Respect the tier: if the client chose Ultra Luxury, prefer hotels marked [UltraLux] wherever one exists; if Luxury, prefer [Luxury]. Never invent a tier.
3. Respect how they feel about changing hotels. One base means ONE leg. Two or three bases means two or three legs. A journey means three to five legs in a sensible geographic order — no doubling back.
4. THE GEOGRAPHIC REALITY CHECK. Use the distances above. A relaxed client with seven nights must not get the spread a fourteen-night see-everything client would. Never put two long transfers in a row. If they want short transfers, choose places that sit close together even if that means leaving out something famous, and say what you left out and why.
5. Nights must total exactly ${answers.nights}. Whole numbers, minimum 2 per leg unless it is a one-night connection.
6. Order the legs the way the region is actually travelled: start near the gateway, end near a gateway.
7. Honour "must do" and "must not do" absolutely. Honour what matters in a hotel when choosing between hotels in a place.
8. A town marked FAR costs a day to reach. Include it only on a long trip, and say so in the tips if you left it out.
9. Write like an advisor who has been there: precise, warm, no exclamation marks, no brochure language. Each "why" SELLS the place to this client in two or three sentences — what they will actually do and see, drawn from the "Why go" line and what draws them — and then names why this hotel. A client who knows nothing should finish reading it wanting to go. If air within the region is poor, say so plainly in the intro and that the road or the boat is the better way.
10. "logic": ONE sentence explaining the shape, in the form "Because you … we have …". For example: "Because you prefer a relaxed pace and one hotel change, we have based you in two places rather than trying to cover four." or "Because boating and swimming are your priorities, we have weighted the trip toward the islands."
11. Tips: three to five short, specific things worth knowing — the season, a booking that needs notice, a transfer that takes longer than people expect, a rental car ONLY if it genuinely helps here. Nothing generic.

Return ONLY a JSON object, no preamble, no markdown fences, in exactly this shape:
{"title":"...","intro":"two or three sentences on the shape of the trip and why it fits them","logic":"Because you …, we have …","legs":[{"city":"...","nights":3,"hotel":"...","why":"..."}],"tips":["...","..."]}`;

  const out = await ask(key, prompt, 2000);
  if (out.error) return res.status(200).json({ ok: false, ...out.error });
  const plan = out.json;
  if (!plan || !Array.isArray(plan.legs) || !plan.legs.length) return res.status(200).json({ ok: false, reason: "shape" });

  // ENFORCE THE RULE SERVER-SIDE. Whatever the model says, a leg or hotel not in the inventory
  // is dropped here, so the app can never seed a trip with something Voyage One does not carry.
  const cities = new Map(inventory.map((d) => [String(d.city).toLowerCase(), d]));
  const legs = plan.legs.map((l) => {
    const d = cities.get(String(l.city || "").toLowerCase());
    if (!d) return null;
    const hotel = (d.hotels || []).find((h) => String(h.name).toLowerCase() === String(l.hotel || "").toLowerCase()) || null;
    return { city: d.city, nights: Math.max(1, Math.round(Number(l.nights) || 1)), hotel: hotel ? hotel.name : null, tier: hotel ? hotel.tier : null, why: String(l.why || "").slice(0, 500) };
  }).filter(Boolean);
  if (!legs.length) return res.status(200).json({ ok: false, reason: "no-valid-legs" });

  return res.status(200).json({ ok: true, plan: {
    title: String(plan.title || `${region}, shaped for you`).slice(0, 120),
    intro: String(plan.intro || "").slice(0, 900),
    logic: String(plan.logic || "").slice(0, 300),
    legs,
    tips: (Array.isArray(plan.tips) ? plan.tips : []).slice(0, 5).map((x) => String(x).slice(0, 300)),
  } });
}
