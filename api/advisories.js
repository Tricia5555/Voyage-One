// Voyage One — U.S. Department of State travel advisories, read from the official feed.
//
// Source: https://travel.state.gov/_res/rss/TAsTWs.xml — the State Department's own RSS of
// every country advisory. Each item carries the country, the level ("Level 3: Reconsider
// Travel"), the date it was issued, the link to the official page, and the full advisory text,
// from which the "due to …" reasons and any "Do not travel to:" / "Reconsider travel to:"
// sub-region lists are pulled.
//
// Cached at Vercel's edge for 7 days (Tricia, 18 Oct 2026: monthly is fine — this is well
// inside that). No scheduled job is claimed: the cache refreshes on the first visit after it
// expires. The app carries its own snapshot as a fallback and as the owner-approved baseline;
// this live read can only RAISE a destination's level, never lower it — lowering ships in a
// build, which is the owner's approval.

export default async function handler(req, res) {
  const FEED = "https://travel.state.gov/_res/rss/TAsTWs.xml";
  try {
    const r = await fetch(FEED, { headers: { "user-agent": "VoyageOne/1.0 (+https://voyageoneworld.com)", accept: "application/rss+xml, application/xml, text/xml" } });
    if (!r.ok) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ok: false, reason: "feed-error", status: r.status, fetchedAt: new Date().toISOString() });
    }
    const xml = await r.text();
    const items = parseFeed(xml);
    if (!items.length) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ok: false, reason: "no-items", fetchedAt: new Date().toISOString() });
    }
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=2592000");
    return res.status(200).json({ ok: true, source: FEED, fetchedAt: new Date().toISOString(), count: items.length, items });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: false, reason: "fetch-failed", detail: String(e).slice(0, 200), fetchedAt: new Date().toISOString() });
  }
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", eacute: "é" };
function unent(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m));
}
function strip(html) { return unent(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function toISO(pub) {
  // The feed prints "Mon, 12 Oct 2026" — no time, no zone. Parse by hand.
  const m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(String(pub || ""));
  if (!m) return null;
  const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].slice(0, 3).toLowerCase());
  if (mon < 0) return null;
  return `${m[3]}-${String(mon + 1).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
}

export function parseFeed(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const it = m[1];
    const tag = (name) => { const x = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">").exec(it); return x ? x[1].trim() : ""; };
    const cat = (dom) => { const x = new RegExp('<category\\s+domain="' + dom + '"\\s*>([\\s\\S]*?)</category>').exec(it); return x ? unent(x[1]).trim() : ""; };
    const cdata = (s) => String(s || "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
    const title = unent(cdata(tag("title")));
    const levelText = cat("Threat-Level") || ((/Level \d: [^<]*/.exec(title) || [""])[0]);
    const lv = /Level\s*(\d)/.exec(levelText);
    const descHtml = cdata(tag("description"));
    const text = strip(descHtml);
    const reasons = ((/\bdue to ([^.]*)\./i.exec(text) || [])[1] || "").trim();
    items.push({
      country: title.split(/\s+-\s+Level/)[0].trim(),
      level: lv ? +lv[1] : null,
      levelText: levelText.trim(),
      tag: cat("Country-Tag"),
      updated: toISO(tag("pubDate")),
      url: unent(cdata(tag("link"))),
      reasons,
      regions: parseRegions(descHtml),
    });
  }
  return items;
}

// Sub-region lists. The advisory body carries headings such as "Do not travel to:",
// "Reconsider travel to:" and "Exercise increased caution in:" followed by a list, and the
// newer pages a "Risks in specific areas" block with the level named inline. Everything found
// is returned with the level the heading implies; the app matches destinations against the
// area text. Heuristic by nature — the owner panel lists every match for review.
function cleanArea(s) {
  return String(s || "").replace(/\s*[\u2013\u2014-]\s*Level\s*\d:.*$/i, "").replace(/\s*(?:due to|because of).*$/i, "").replace(/[.\s]+$/, "").trim();
}
export function parseRegions(html) {
  const out = [];
  const src = String(html || "");
  const heads = [
    { re: /do not travel to\b[^<:]*:?/i, level: 4 },
    { re: /reconsider travel to\b[^<:]*:?/i, level: 3 },
    { re: /exercise increased caution (?:in|when travel(?:l)?ing to)\b[^<:]*:?/i, level: 2 },
  ];
  // Split the body into blocks on block-level tags, keep the order, and walk it: a heading sets
  // the current level; following list items / short paragraphs are areas until the next heading.
  const blocks = src.split(/<\/?(?:p|li|h\d|div|ul|ol|br)\b[^>]*>/i).map((b) => strip(b)).filter(Boolean);
  let cur = null;
  for (const b of blocks) {
    const h = heads.find((x) => x.re.test(b));
    if (h) {
      cur = h.level;
      // Inline form: "Do not travel to: Arauca, Cauca … due to crime."
      const after = b.replace(h.re, "").trim();
      if (after && after.length > 3 && after.length < 400) after.split(/;\s*/).forEach((part) => { const a = cleanArea(part); if (a) out.push({ area: a, level: h.level, reason: ((/(?:due to|because of) ([^.;]*)/i.exec(part) || [])[1] || "") }); });
      continue;
    }
    if (cur && b.length < 320 && !/^(country summary|if you decide to travel|read the|visit|u\.s\. citizens|the u\.s\. embassy|review the)/i.test(b)) {
      const lvInline = /Level\s*(\d)/.exec(b);
      const a = cleanArea(b); if (a) out.push({ area: a, level: lvInline ? +lvInline[1] : cur, reason: ((/(?:due to|because of) ([^.;]*)/i.exec(b) || [])[1] || "") });
    } else if (cur && b.length >= 320) {
      cur = null;   // a full paragraph ends the list
    }
  }
  // Newer pages: "Area name – Level 4: Do Not Travel" lines anywhere in the body.
  const inline = /([A-Z][^<>.;:]{3,120}?)\s*[–—-]\s*Level\s*(\d):\s*(Do Not Travel|Reconsider Travel|Exercise Increased Caution)/g;
  let m;
  while ((m = inline.exec(strip(src)))) {
    const area = m[1].trim();
    if (!out.some((x) => x.area.toLowerCase() === area.toLowerCase())) out.push({ area, level: +m[2], reason: "" });
  }
  const seen = new Set();
  return out.filter((x) => { const k = x.area.toLowerCase() + "|" + x.level; if (!x.area || x.level < 2 || seen.has(k)) return false; seen.add(k); return true; });
}
