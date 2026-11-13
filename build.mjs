// Builds catalog.json from public feeds (run by GitHub Actions; no Cloudflare, no server).
import fs from "node:fs";
const UA = { "User-Agent": "rwnq8-tv/1.0 (+https://github.com/rwnq8/tv)" };
const MAX = 80; // per channel; accumulates across runs so the guide keeps growing
const dec = s => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
async function get(u) { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) }); return r.ok ? await r.text() : ""; } catch { return ""; } }
async function json(u) { try { return JSON.parse(await get(u)); } catch { return {}; } }
const hms = s => { const p = String(s || "").split(":").map(Number); return p.some(isNaN) ? 0 : p.reduce((a, x) => a * 60 + x, 0); };
// Curation: only hand-picked channels and archive collections; anything searched (PeerTube) needs a real audience; clickbait titles never enter.
const BAIT = [/you won'?t believe/i, /\bshocking\b/i, /\bgone wrong\b/i, /!{2,}/, /\?!|!\?/, /\bmust (see|watch)\b/i, /\bwait for it\b/i, /\bmind[- ]?blow/i, /\bbreaking:/i, /\bexposed\b/i, /\bdestroyed\b/i, /\binsane\b/i, /\bnobody (talks|tells)\b/i, /\bthe truth about\b/i, /\bwhat happened next\b/i, /\b(top|best) \d+\b/i, /\bsecrets? (they|doctors|the government)\b/i];
const caps = t => { const l = t.replace(/[^A-Za-z]/g, ""); return l.length > 8 && l.replace(/[^A-Z]/g, "").length / l.length > 0.6; };
const emojis = t => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t);
const clean = v => v.t && !BAIT.some(r => r.test(v.t)) && !caps(v.t) && !emojis(v.t);
const rnd = n => 1 + Math.floor(Math.random() * n);
const src = {
  async yt(s) { // RSS has no duration; the player reports it at play time (d:0)
    const x = await get("https://www.youtube.com/feeds/videos.xml?channel_id=" + s.id), out = [];
    for (const m of x.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]*)<\/title>/g)) out.push({ s: "yt", i: m[1], t: dec(m[2]), b: s.by, d: 0 });
    return out.filter(v => !/#shorts/i.test(v.t));
  },
  async ia(s) {
    const j = await json("https://archive.org/advancedsearch.php?q=" + encodeURIComponent(s.q) + "&fl[]=identifier&fl[]=title&rows=30&page=" + rnd(6) + "&sort[]=downloads+desc&output=json");
    const docs = (j.response && j.response.docs) || [], out = [];
    await Promise.all(docs.map(async d => {
      const m = await json("https://archive.org/metadata/" + d.identifier);
      const rt = m.metadata && m.metadata.runtime, dur = hms(Array.isArray(rt) ? rt[0] : rt) || (m.files || []).map(f => +f.length || 0).reduce((a, b) => Math.max(a, b), 0);
      if (dur >= 60) out.push({ s: "ia", i: d.identifier, t: dec(d.title), b: s.by, d: Math.round(dur) });
    }));
    return out;
  },
  async vimeo(s) {
    const x = await get("https://vimeo.com/channels/staffpicks/videos/rss"), out = [];
    for (const m of x.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>https:\/\/vimeo\.com\/(?:channels\/staffpicks\/)?(\d+)/g)) {
      const o = await json("https://vimeo.com/api/oembed.json?url=https://vimeo.com/" + m[2]);
      if (o.duration) out.push({ s: "vimeo", i: m[2], t: dec(m[1]), b: s.by, d: o.duration });
    }
    return out;
  },
  async pt(s) {
    const j = await json("https://sepiasearch.org/api/v1/search/videos?search=" + encodeURIComponent(s.q) + "&count=40&sort=-views&nsfw=false&durationMin=120&durationMax=5400&start=" + Math.floor(Math.random() * 40));
    return (j.data || []).filter(v => v.embedUrl && !v.isLive && (v.views || 0) >= 20000 && (v.likes || 0) >= 100).map(v => ({ s: "pt", i: v.embedUrl, t: v.name, b: (v.channel && v.channel.displayName) || s.by, d: v.duration }));
  },
  async dm(s) {
    const j = await json("https://api.dailymotion.com/videos?search=" + encodeURIComponent(s.q) + "&fields=id,title,duration,owner.screenname&limit=30&sort=visited-week&family_filter=1&longer_than=2&page=" + rnd(3));
    return (j.list || []).map(v => ({ s: "dm", i: v.id, t: v.title, b: v["owner.screenname"] || s.by, d: v.duration }));
  }
};
let prev = {}; try { prev = JSON.parse(fs.readFileSync("catalog.json", "utf8")); } catch {}
const cfg = JSON.parse(fs.readFileSync("channels.json", "utf8")), out = { built: new Date().toISOString(), channels: [] }, report = [];
for (const ch of cfg.channels) {
  const lists = await Promise.all(ch.sources.map(async s => { const r = await src[s.t](s).catch(() => []); report.push(ch.id + "/" + s.by + ": " + r.length); return r; }));
  const old = (((prev.channels || []).find(c => c.id === ch.id) || {}).items || []).filter(v => v.s !== "dm" && v.s !== "pt"), seen = new Set(), items = [];
  for (const v of [].concat(...lists, old)) { const k = v.s + ":" + v.i; if (!seen.has(k) && clean(v)) { seen.add(k); items.push(v); } }
  const by = {}; items.forEach(v => (by[v.b] = by[v.b] || []).push(v)); // trim round-robin so no source dominates
  const keep = []; for (let more = true; more && keep.length < MAX;) { more = false; for (const k of Object.keys(by)) { const v = by[k].shift(); if (v && keep.length < MAX) { keep.push(v); more = true; } } }
  out.channels.push({ n: ch.n, id: ch.id, name: ch.name, blurb: ch.blurb, items: keep });
}
fs.writeFileSync("catalog.json", JSON.stringify(out));
console.log(report.join("\n")); console.log(out.channels.map(c => c.id + "=" + c.items.length).join(" "));
if (out.channels.some(c => c.items.length < 10)) { console.error("channel under 10 items"); process.exit(1); }
