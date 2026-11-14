// api/errors.js — THE ERROR LOG (M1062, 14 Nov 2026).
//
// WHY THIS EXISTS
// Until now nobody was told when the site broke for a client. A page that failed to appear, or a
// screen that crashed half-way through a trip, was only ever found by Tricia looking. A small
// script at the top of index.html now catches every such failure in the client's browser and
// posts it here. This function:
//   1. writes it to the `site_errors` table in Supabase (with the service key — the table has no
//      policies, so nothing in a browser can read it);
//   2. e-mails Tricia, when mail is set up — at most once every six hours for the same error, so a
//      fault that hits fifty clients sends one e-mail and not fifty.
//
// WHAT IT RECORDS: the build label, the error text, where in the code, the page address and the
// browser. WHAT IT DOES NOT: who the client is. No name, no e-mail, no account.
//
// Env in Vercel (all already used elsewhere): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; and for the
// e-mail, RESEND_API_KEY, RESERVE_FROM, RESERVE_TO. Without the mail three it still records.
// One-time database setup: site-errors.sql, run once in Supabase → SQL Editor.

const URL_ = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const H = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
const s = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const QUIET_HOURS = 6;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, reason: "POST only" });
  if (!URL_ || !KEY) return res.status(200).json({ ok: false, reason: "not configured" });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};

  const row = {
    build: s(b.build, 20), kind: s(b.kind, 20), message: s(b.message, 500), stack: s(b.stack, 4000),
    source: s(b.source, 300), line: Number(b.line) || null, col: Number(b.col) || null,
    page: s(b.page, 300), browser: s(req.headers["user-agent"], 300),
  };
  if (!row.message) return res.status(400).json({ ok: false, reason: "no message" });

  try {
    // Has this same error already been reported in the quiet period? Then record it, send no mail.
    const since = new Date(Date.now() - QUIET_HOURS * 3600 * 1000).toISOString();
    const seen = await fetch(`${URL_}/rest/v1/site_errors?select=id&message=eq.${encodeURIComponent(row.message)}&created_at=gte.${encodeURIComponent(since)}&limit=1`, { headers: H() });
    const seenRows = seen.ok ? await seen.json() : [];
    const isNew = !(Array.isArray(seenRows) && seenRows.length);

    const ins = await fetch(`${URL_}/rest/v1/site_errors`, { method: "POST", headers: { ...H(), Prefer: "return=minimal" }, body: JSON.stringify(row) });
    if (!ins.ok) return res.status(200).json({ ok: false, reason: "could not save", status: ins.status });

    const key = process.env.RESEND_API_KEY, from = process.env.RESERVE_FROM || "", to = process.env.RESERVE_TO || "";
    let mailed = false;
    if (isNew && key && from && to) {
      const text = [
        "Voyage One reported an error in a client's browser.", "",
        `Build:    ${row.build || "unknown"}`, `Kind:     ${row.kind || ""}`, `Error:    ${row.message}`,
        `Where:    ${row.source || ""}${row.line ? ` line ${row.line}` : ""}`, `Page:     ${row.page || ""}`, `Browser:  ${row.browser || ""}`, "",
        row.stack || "", "",
        `The same error will not be e-mailed again for ${QUIET_HOURS} hours. Every occurrence is in Supabase → Table Editor → site_errors.`,
      ].join("\n");
      const out = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject: `Voyage One error (${row.build || "?"}): ${row.message.slice(0, 80)}`, text }) });
      mailed = out.ok;
    }
    return res.status(200).json({ ok: true, mailed });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "failed" });
  }
}
