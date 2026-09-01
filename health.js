// /api/health — one URL that answers "is anything broken?"
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

// Google Places (New). This is the one that failed silently, so it is checked first and its
// failure detail is preserved verbatim.
async function checkGoogle() {
  const key =
