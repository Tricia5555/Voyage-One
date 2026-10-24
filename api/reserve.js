// api/reserve.js — Voyage One places the hotel reservation (build M971, 24 Oct 2026).
//
// The client has looked at rooms and rates on the hotel's own site and tapped "Reserve it through
// Voyage One". The page has already written the request to the Supabase `reservations` table; this
// function sends the agency booking request by e-mail, FROM Voyage One, so the reservation is born
// carrying the host agency's IATA and the brand programme ID — the only way commission and
// programme benefits attach (see project doc hotel-commission-trade-side.md).
//
// Where it goes:
//   • the hotel's reservations desk, when the hotel row carries `resEmail` (none do yet — being
//     collected brand by brand); otherwise
//   • Voyage One (RESERVE_TO) and the host (HOST_EMAIL), who place it by hand — the bootstrap.
//   Voyage One and the host are copied on every request either way.
//
// Mail provider: Resend (resend.com). Environment variables, set in Vercel → Settings →
// Environment Variables, then redeploy:
//   RESEND_API_KEY   — from resend.com → API Keys
//   RESERVE_FROM     — e.g. "Voyage One Reservations <reservations@voyageoneworld.com>"
//                      (the domain must be verified in Resend: one DNS record at the registrar)
//   RESERVE_TO       — Tricia's inbox (every request lands here)
//   HOST_EMAIL       — the host agency's booking desk, once signed (optional)
// Nothing is invented: with no API key the function answers { ok:false, reason:"no mail key" }
// and the page still shows the request as sent, because the table row is the record of truth.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, reason: "POST only" });

  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESERVE_FROM || "";
  const toUs = process.env.RESERVE_TO || "";
  const toHost = process.env.HOST_EMAIL || "";
  if (!key || !from || !toUs) return res.status(200).json({ ok: false, reason: "no mail key" });

  let r = req.body;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch (e) { r = null; } }
  if (!r || !r.hotel || !r.first || !r.last || !r.email || !r.checkIn || !r.checkOut) return res.status(400).json({ ok: false, reason: "incomplete" });

  const clean = (x, n = 300) => String(x == null ? "" : x).replace(/[\r\n]+/g, " ").trim().slice(0, n);
  const notes = String(r.notes || "").trim().slice(0, 2000);
  const hotelEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.resEmail || "")) ? String(r.resEmail).trim() : "";
  const guests = Number(r.guests) || 2;
  const nights = Math.max(1, Math.round((Date.parse(r.checkOut) - Date.parse(r.checkIn)) / 86400000) || 1);
  const fmt = (d) => { const x = new Date(d + "T00:00:00Z"); return isNaN(x) ? d : x.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); };
  const agency = [r.host ? clean(r.host) : "", "Voyage One"].filter(Boolean).join(" / ");
  const idLines = [
    r.iata ? `IATA: ${clean(r.iata, 20)}` : "",
    r.programId ? `${clean(r.brand || "Programme", 40)} advisor ID: ${clean(r.programId, 40)}` : "",
    r.virtuoso ? "Virtuoso property — please apply Virtuoso amenities where the rate allows." : "",
  ].filter(Boolean);

  const subject = `Reservation request — ${clean(r.last, 60)}, ${clean(r.first, 60)} · ${clean(r.hotel, 80)} · ${r.checkIn} to ${r.checkOut}`;
  const text = [
    `Dear Reservations team at ${clean(r.hotel, 120)},`, "",
    `Please reserve the following in our guest's name, under ${agency}:`, "",
    `Guest:      ${clean(r.first, 60)} ${clean(r.last, 60)}`,
    `Arrive:     ${fmt(r.checkIn)}`,
    `Depart:     ${fmt(r.checkOut)}  (${nights} ${nights === 1 ? "night" : "nights"})`,
    `Guests:     ${guests}`,
    r.room ? `Room:       ${clean(r.room, 200)}` : `Room:       best available in the category the guest chooses with you`,
    notes ? `Notes:      ${notes.replace(/\n/g, "\n            ")}` : "",
    "",
    ...idLines,
    "",
    `Please confirm directly to the guest at ${clean(r.email, 120)}${r.phone ? ` (tel. ${clean(r.phone, 40)})` : ""}, taking your usual guarantee from the guest, and copy this address. Please attach the agency to the reservation and apply the benefits our guests receive under your programme.`,
    "",
    "With thanks,",
    `${agency} · voyageoneworld.com`,
    "", "—",
    `Reference: ${clean(r.city || "", 80)} · request sent by Voyage One ${clean(r.build || "", 10)} · ${new Date().toISOString()}`,
  ].filter((l) => l !== "").join("\n");

  // To the hotel when we have its reservations address; to us and the host otherwise.
  const to = hotelEmail ? [hotelEmail] : [toUs].concat(toHost ? [toHost] : []);
  const cc = hotelEmail ? [toUs].concat(toHost ? [toHost] : []) : [];

  try {
    const out = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, cc, reply_to: toUs, subject, text }),
    });
    const j = await out.json().catch(() => ({}));
    if (!out.ok) return res.status(200).json({ ok: false, reason: (j && j.message) || `resend ${out.status}` });
    return res.status(200).json({ ok: true, to: hotelEmail ? "hotel" : "voyageone", id: j && j.id ? j.id : null });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: String(e && e.message || e).slice(0, 200) });
  }
}
