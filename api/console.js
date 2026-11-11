// api/console.js — THE CLIENT BOOK (M1053, 11 Nov 2026).
//
// The private record of every client, for Voyage One's staff only (Tricia and Franny). The page at
// voyageoneworld.com/?console signs the person in with their ordinary Voyage One account and sends
// their sign-in token here. This function:
//   1. asks Supabase who the token belongs to, and refuses anyone whose e-mail is not in the
//      `staff` table;
//   2. reads every record with the service key (never exposed to the browser): TravelPro bookings
//      (`client_bookings`), reservation requests (`reservations`), journeys built on the site
//      (`trips`), "Booked" marks (`bookings`), and the account e-mails behind them;
//   3. adds a booking or saves a note about a client.
//
// Why a server function and not the browser: the journeys and profiles are protected so that each
// client sees only their own. Opening them to staff in the browser would have put every client's
// trips on Tricia's own shelf in the app. Here the protection stays exactly as it is for clients.
//
// Env in Vercel (already set for the rooms store): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// One-time database setup: client-book.sql, run once in Supabase → SQL Editor.

const URL_ = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const H = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });

async function rest(path, opts = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
  const text = await r.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: r.ok, status: r.status, body };
}

async function whoIs(token) {
  if (!token) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.email ? { id: u.id, email: String(u.email).toLowerCase() } : null;
}

async function isStaff(email) {
  const r = await rest(`staff?email=eq.${encodeURIComponent(email)}&select=email,name`);
  return r.ok && Array.isArray(r.body) && r.body.length ? r.body[0] : null;
}

// A table that does not exist yet (the setup not run, or a feature not used) reads as empty, with
// a note — the Client Book still opens.
async function readTable(path, notes, label) {
  const r = await rest(path);
  if (r.ok && Array.isArray(r.body)) return r.body;
  notes.push(`${label}: ${r.status} ${typeof r.body === "object" && r.body && r.body.message ? r.body.message : ""}`.trim());
  return [];
}

async function allUsers(notes) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) { notes.push(`accounts: ${r.status}`); break; }
    const j = await r.json();
    const list = (j && j.users) || [];
    list.forEach((u) => out.push({ id: u.id, email: u.email || "", created: u.created_at || null, lastSeen: u.last_sign_in_at || null }));
    if (list.length < 1000) break;
  }
  return out;
}

// A journey, reduced to what the Client Book shows: who, when, where, which hotels and tables.
function tripSummary(row) {
  const d = (row && row.data) || {};
  const travelers = (Array.isArray(d.travelers) ? d.travelers : []).filter((x) => x && (x.first || x.last)).map((x) => ({ first: String(x.first || "").trim(), last: String(x.last || "").trim() }));
  const legs = (Array.isArray(d.dests) ? d.dests : []).filter((x) => x && x.city).map((x) => {
    const p = x.pick || {};
    const stops = Array.isArray(p.stops) ? p.stops : [];
    const hotels = [p.stay && p.stay.name].concat(stops.map((s) => s && s.stay && s.stay.name)).filter(Boolean);
    const dines = [].concat(p.dines || [], ...stops.map((s) => (s && s.dines) || [])).filter((y) => y && y.name).map((y) => ({ name: y.name, date: y.date || "" }));
    return { city: x.city, nights: x.nights || null, hotels, dines };
  });
  return {
    id: row.id, user_id: row.user_id, name: row.name || d.tripName || "", updated: row.updated_at || null,
    travelers, depart: (d.dates && d.dates.depart) || "", ret: (d.dates && d.dates.ret) || "",
    from: d.fromCity || "", legs,
  };
}

const s = (v, n = 300) => (v == null ? null : String(v).trim().slice(0, n) || null);
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, reason: "POST only" });
  if (!URL_ || !KEY) return res.status(200).json({ ok: false, reason: "not configured", detail: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set in Vercel." });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};

  const me = await whoIs(b.token);
  if (!me) return res.status(401).json({ ok: false, reason: "signed out" });
  const staff = await isStaff(me.email);
  if (!staff) return res.status(403).json({ ok: false, reason: "not staff", email: me.email });

  if (b.action === "load") {
    const notes = [];
    const [travelpro, requests, trips, marks, users, clientNotes] = await Promise.all([
      readTable("client_bookings?select=*&order=created_at.desc&limit=5000", notes, "client_bookings"),
      readTable("reservations?select=*&order=created_at.desc&limit=5000", notes, "reservations"),
      readTable("trips?select=id,user_id,name,data,updated_at&order=updated_at.desc&limit=3000", notes, "trips"),
      readTable("bookings?select=*&order=created_at.desc&limit=5000", notes, "bookings"),
      allUsers(notes),
      readTable("client_notes?select=*", notes, "client_notes"),
    ]);
    return res.status(200).json({ ok: true, me: { email: me.email, name: staff.name || null }, travelpro, requests, trips: trips.map(tripSummary), marks, users, notes: clientNotes, problems: notes });
  }

  if (b.action === "add") {
    const x = b.booking || {};
    if (!s(x.last) || !s(x.hotel)) return res.status(400).json({ ok: false, reason: "a last name and a hotel are needed" });
    const row = {
      source: s(x.source, 40) || "entered", client_first: s(x.first, 80), client_last: s(x.last, 80), client_email: s(x.email, 160) && s(x.email, 160).toLowerCase(),
      client_phone: s(x.phone, 60), hotel: s(x.hotel, 160), city: s(x.city, 120), country: s(x.country, 80),
      check_in: day(x.check_in), check_out: day(x.check_out), guests: Number(x.guests) || null, room: s(x.room, 200),
      rate: s(x.rate, 200), total: x.total == null || x.total === "" ? null : Number(x.total) || null, currency: s(x.currency, 8),
      confirmation: s(x.confirmation, 80), status: s(x.status, 40) || "confirmed", notes: s(x.notes, 4000), created_by: me.email,
    };
    const r = await rest("client_bookings", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    return res.status(200).json(r.ok ? { ok: true, booking: r.body && r.body[0] } : { ok: false, reason: "could not save", detail: r.body });
  }

  if (b.action === "note") {
    const key = s(b.client, 200); if (!key) return res.status(400).json({ ok: false, reason: "no client" });
    const r = await rest("client_notes?on_conflict=client_key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ client_key: key.toLowerCase(), note: s(b.note, 8000) || "", updated_by: me.email, updated_at: new Date().toISOString() }) });
    return res.status(200).json(r.ok ? { ok: true } : { ok: false, reason: "could not save", detail: r.body });
  }

  return res.status(400).json({ ok: false, reason: "unknown action" });
}
