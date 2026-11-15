// /api/health — one URL that answers "is anything broken?"
// (M1063, 14 Nov 2026: the copy of this file on GitHub had been cut off at line 42 since it was first
// uploaded, so the address answered with an error page and never worked. This is the whole file.)
//
// WHY THIS EXISTS
// On 31 August 2026 the Google Cloud free trial expired. Every Places and Geocoding call started
// returning 403 PERMISSION_DENIED. The site stayed up, returned HTTP 200 throughout, and showed
// no error anywhere: citysearch quietly fell back to Duffel's airport list, hotel photos went
// blank, and any town without an airport became unreachable. It was found by accident, hours in.
//
// A plain up/down monitor would NOT have caught that — the endpoints were "up" the whole time.
// So this endpoint actually calls each dependency and reports what it finds, and an external
// monitor watches for the string "ok":true in the response body. When that string disappears,
// something is genuinely broken and the alert fires.
//
// WHAT IT DOES NOT DO
// It never returns a key, a token, or any part of one. It reports presence and outcome only.
// Google's error text is passed through trimmed, because "PERMISSION_DENIED" versus
// "API_KEY_INVALID" is the difference between a billing problem and a credentials problem, and
// knowing which saves an hour. Nothing in that text is secret.
//
// COST
// Each run makes three small requests. Google's is the only billable one, asked for a single
// result with a minimal field mask to stay in the cheapest tier. At a 15-minute monitor interval
// that is roughly 2,900 calls a month — pennies, but not nothing. Do not poll every minute.

const TIMEOUT_MS = 8000;

// A fetch that gives up rather than hanging. A health check that never returns is worse than one
// that fails: the monitor times out and reports "down" without saying what was wrong.
async function timedFetch(url, opts) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}


const trim = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 200);
const why = (e) => (e && e.name === "AbortError" ? `no answer in ${TIMEOUT_MS / 1000} seconds` : trim(e && e.message) || "request failed");

// Google Places (New). This is the one that failed silently, so it is checked first and its
// failure detail is preserved verbatim. One result, ids only — the cheapest request there is.
async function checkGoogle() {
  const key = (process.env.GOOGLE_PLACES_KEY || "").trim();
  if (!key) return { ok: false, detail: "GOOGLE_PLACES_KEY is not set in Vercel" };
  try {
    const r = await timedFetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id" },
      body: JSON.stringify({ textQuery: "Claridge's London", maxResultCount: 1 }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, detail: `${r.status} ${trim(j && j.error && (j.error.status + " " + j.error.message))}`.trim() };
    if (!j || !Array.isArray(j.places) || !j.places.length) return { ok: false, detail: "answered, but found nothing for a hotel that exists" };
    return { ok: true };
  } catch (e) { return { ok: false, detail: why(e) }; }
}

// Duffel — flights and the airport list. A place lookup, which costs nothing.
async function checkDuffel() {
  const token = (process.env.DUFFEL_TOKEN || "").trim();
  if (!token) return { ok: false, detail: "DUFFEL_TOKEN is not set in Vercel" };
  try {
    const r = await timedFetch("https://api.duffel.com/places/suggestions?query=London", {
      headers: { Accept: "application/json", "Duffel-Version": "v2", Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, detail: `${r.status} ${trim(j && j.errors && j.errors[0] && (j.errors[0].title || j.errors[0].message))}`.trim() };
    if (!j || !Array.isArray(j.data) || !j.data.length) return { ok: false, detail: "answered, but found no airports for London" };
    return { ok: true };
  } catch (e) { return { ok: false, detail: why(e) }; }
}

// Supabase — accounts, saved journeys, the Client Book. Reads one id from the error log's own table.
async function checkSupabase() {
  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return { ok: false, detail: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in Vercel" };
  try {
    const r = await timedFetch(`${url}/rest/v1/site_errors?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) { const j = await r.json().catch(() => null); return { ok: false, detail: `${r.status} ${trim(j && j.message)}`.trim() }; }
    return { ok: true };
  } catch (e) { return { ok: false, detail: why(e) }; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const [google, duffel, supabase] = await Promise.all([checkGoogle(), checkDuffel(), checkSupabase()]);
  // Keys that are only checked for presence: calling these services costs money each time.
  const keys = {
    anthropic: !!(process.env.ANTHROPIC_API_KEY || "").trim(),
    mail: !!((process.env.RESEND_API_KEY || "").trim() && (process.env.RESERVE_FROM || "").trim() && (process.env.RESERVE_TO || "").trim()),
  };
  const ok = google.ok && duffel.ok && supabase.ok;
  // "ok" is first on purpose: the monitor looks for the exact text "ok":true at the start of the answer.
  // M1065: HTTP 200 when all is well, 503 when anything is broken — so a plain up/down monitor (the
  // free kind, which reads only the status and not the text) raises the alarm too. The text still
  // says what is wrong.
  return res.status(ok ? 200 : 503).json({ ok, checked: new Date().toISOString(), google, duffel, supabase, keys });
}
