// "Snowball" crawl: webcam operators on YouTube usually run many 24/7 streams. For every channel that already has
// a stream in public/data/youtube.json, open the channel's Live tab and add every stream that's live right now,
// placed on the globe by matching its title against the multilingual gazetteer. Unplaceable streams are skipped.
// New finds are APPENDED to youtube.json. Run it again to crawl the channels discovered in the previous round.
//   node scripts/snowball-youtube.mjs

import { writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'data', 'youtube.json');
const STATE = join(HERE, 'data', 'channels-crawled.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const HDRS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Extra well-known live-cam channels to seed the crawl.
const SEED_CHANNELS = [
  'https://www.youtube.com/@VirtualRailfan', 'https://www.youtube.com/@EarthCam', 'https://www.youtube.com/@exploreorg',
  'https://www.youtube.com/@SkylineWebcams', 'https://www.youtube.com/@webcamtaxi', 'https://www.youtube.com/@PTZtv',
  'https://www.youtube.com/@AfriCamLive', 'https://www.youtube.com/@NamibiaWildlifeCam', 'https://www.youtube.com/@SeeJH',
  'https://www.youtube.com/@IcelandLiveCams', 'https://www.youtube.com/@TOKYOLiveCameraTV', 'https://www.youtube.com/@CornellLabBirdCams',
];

// ---------- gazetteer (same rules as sweep-youtube.mjs) ----------
const GAZ = JSON.parse(await readFile(join(HERE, 'data', 'gazetteer.json'), 'utf8'));
for (const g of GAZ) for (const n of [...g.n]) {
  const bare = n.replace(/(광역시|특별시|특별자치시|특별자치도|시|도|군|구|都|府|県|市|区|町|省|自治区)$/, '');
  if (bare !== n && bare.length >= 2 && !g.n.includes(bare)) g.n.push(bare);
}
const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const isCjk = s => /[぀-ヿ㐀-鿿가-힯]/.test(s);
// Pre-compile one entry per name. Short Latin names (≤4 letters) are too ambiguous worldwide, so skip them here.
const NAMES = [];
for (const g of GAZ) for (const n of g.n) {
  const f = fold(n);
  if (!isCjk(n) && f.length < 5) continue;
  NAMES.push({ g, f, cjk: isCjk(n), re: isCjk(n) ? null : new RegExp(`(^|[^\\p{L}])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u') });
}
function geocode(text) {
  const t = fold(text);
  let best = null;
  for (const e of NAMES) {
    if (e.cjk ? !t.includes(e.f) : !(t.includes(e.f) && e.re.test(t))) continue;
    if (!best || e.f.length > best.f.length || (e.f.length === best.f.length && e.g.p > best.g.p)) best = e;
  }
  return best?.g || null;
}
function category(title) {
  const t = fold(title);
  if (/beach|playa|praia|strand|plage|spiaggia|해수욕장|ビーチ|海水浴|surf/.test(t)) return 'beach';
  if (/airport|aeropuerto|aeroporto|flughafen|空港|공항|planespotting|railcam|railfan|train|駅|鉄道|新幹線|harbou?r|port of|hafen|porto|puerto|港|ship|ferry|canal/.test(t)) return 'transport';
  if (/zoo|wildlife|animal|bird|nest|eagle|bear|safari|aquarium|volcano|vulkan|火山|ski|mountain|berg|山|lake|river|川|falls|forest|nature|snow|雪|waterhole|reef/.test(t)) return 'nature';
  if (/traffic|highway|autobahn|motorway|道路|高速|cctv|交通/.test(t)) return 'traffic';
  if (/aurora|northern lights|weather|sky/.test(t)) return 'weather';
  return 'city';
}
const BAD = /walk|散歩|歩き|driving|dashcam|radio|lofi|lo-fi|music|news|ニュース|뉴스|replay|highlights|recorded|timelapse|game|gta|asmr|sermon|podcast|gameplay/i;

// ---------- YouTube helpers ----------
async function getHtml(url) {
  for (let i = 1; i <= 3; i++) {
    try { const r = await fetch(url, { headers: HDRS, signal: AbortSignal.timeout(30000) }); return await r.text(); }
    catch (e) { if (i === 3) throw e; await sleep(3000 * i); }
  }
}
async function channelOf(videoId) {
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`, { headers: { 'User-Agent': UA } });
  return r.ok ? (await r.json()).author_url : null;
}
// Reads the channel's public Live tab page (its first ~30 streams; no internal API calls).
async function liveStreamsOf(channelUrl) {
  const html = await getHtml(channelUrl.replace(/\/$/, '') + '/streams');
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const out = [];
  // Channel tabs use either the classic videoRenderer or the newer lockupViewModel layout.
  JSON.stringify(JSON.parse(m[1]), (k, v) => {
    if (k === 'videoRenderer') {
      const s = JSON.stringify(v.thumbnailOverlays || '') + JSON.stringify(v.badges || '') + JSON.stringify(v.viewCountText || '');
      if (/"LIVE"|BADGE_STYLE_TYPE_LIVE_NOW|watching/.test(s)) out.push({ id: v.videoId, title: (v.title?.runs || []).map(r => r.text).join('') || v.title?.simpleText || '' });
    } else if (k === 'lockupViewModel' && v.contentId) {
      if (/BADGE_STYLE_LIVE|"text":"LIVE"/.test(JSON.stringify(v.contentImage || ''))) out.push({ id: v.contentId, title: v.metadata?.lockupMetadataViewModel?.title?.content || '' });
    }
    return v;
  });
  return out;
}
const embeddable = async id => (await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { headers: { 'User-Agent': UA } })).ok;

// ---------- run ----------
const existing = JSON.parse(await readFile(OUT, 'utf8'));
const used = new Set(existing.map(e => e.id));
let crawled = [];
try { crawled = JSON.parse(await readFile(STATE, 'utf8')); } catch {}
const done = new Set(crawled);

// 1) Find the channel behind every stream we have (oEmbed author_url), skipping channels already crawled.
const channels = new Set(SEED_CHANNELS.filter(c => !done.has(c)));
const needLookup = existing.filter(e => !e.channelUrl);
console.log(`Looking up channels for ${needLookup.length} streams…`);
for (let i = 0; i < needLookup.length; i += 8) {
  await Promise.all(needLookup.slice(i, i + 8).map(async e => { try { e.channelUrl = await channelOf(e.id); } catch {} }));
}
for (const e of existing) if (e.channelUrl && !done.has(e.channelUrl)) channels.add(e.channelUrl);
console.log(`Crawling ${channels.size} channels' Live tabs…`);

// 2) Crawl each channel's Live tab.
const found = [];
let n = 0;
for (const ch of channels) {
  n++;
  try {
    const streams = (await liveStreamsOf(ch)).filter(v => !used.has(v.id) && !BAD.test(v.title));
    let added = 0;
    for (const v of streams) {
      used.add(v.id);
      const g = geocode(v.title);
      if (!g || !(await embeddable(v.id))) continue;
      found.push({ id: v.id, title: v.title.slice(0, 120), channel: '', channelUrl: ch, place: `${g.n[0]}, ${g.a}`, la: g.la, lo: g.lo, c: category(v.title), src: 'snowball' });
      added++;
    }
    if (added) console.log(`✔ ${ch.replace('https://www.youtube.com/', '').slice(0, 34).padEnd(34)} +${added} (of ${streams.length} live)`);
  } catch (e) { console.log(`✘ ${ch}: ${e.message}`); }
  done.add(ch);
  if (n % 20 === 0) {
    await writeFile(OUT, JSON.stringify(existing.concat(found), null, 1));
    await writeFile(STATE, JSON.stringify([...done]));
    console.log(`… ${n}/${channels.size} channels, ${found.length} new streams so far`);
  }
  await sleep(1200);
}
await writeFile(OUT, JSON.stringify(existing.concat(found), null, 1));
await writeFile(STATE, JSON.stringify([...done]));
console.log(`\nSnowball added ${found.length} streams from ${channels.size} channels; youtube.json now has ${existing.length + found.length}. Run again to crawl newly found channels.`);
