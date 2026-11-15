// Builds public/data/cameras.json: LIVE VIDEO cameras only (no refreshing snapshots, no recorded loops).
// Run:  node scripts/build-cameras.mjs        (optionally set WINDY_API_KEY=... first)
//
// Sources: state transportation departments that publish public HLS video streams, curated 24/7 YouTube
// live streams, and (with a free key) Windy webcams that have a live player.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Local secrets (e.g. WINDY_API_KEY) live in .env, which is git-ignored. Real env vars win.
try {
  for (const line of (await readFile(join(ROOT, '.env'), 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const OUT = join(ROOT, 'public', 'data', 'cameras.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// ---------- helpers ----------
async function get(url, { type = 'json', headers = {}, timeout = 45000, tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip', ...headers }, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return type === 'json' ? await res.json() : await res.text();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}
const round = n => Math.round(n * 1e5) / 1e5;
const okCoord = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const isHls = u => /^https:\/\/.+\.m3u8(\?|$)/i.test(u || '') && !/token=|signature=|expires=/i.test(u);

// Camera record (compact; expanded by the client):
// { s: sourceKey, t: title, la, lo, k: 'hls'|'yt'|'windy', c: category, v?: hls url, poster?: jpg, yt?: id, w?: windy id, wp?: player url, r?: region }

// ---------- 511-platform sites whose video streams are public ----------
// (Georgia, Florida and Pennsylvania also list streams, but they need a session token from their own site.)
const SITES_511 = [
  ['nv', 'https://www.nvroads.com', 'NV Roads', 'Nevada, US'],
  ['la', 'https://511la.org', '511 Louisiana', 'Louisiana, US'],
  // These two refuse non-US networks; they fill in when the build runs on GitHub's US servers.
  ['wi', 'https://511wi.gov', '511 Wisconsin', 'Wisconsin, US'],
  ['ut', 'https://www.udottraffic.utah.gov', 'UDOT Traffic', 'Utah, US'],
];

// ---------- Caltrans (California): 12 districts, many with live HLS. Geo-blocks non-US networks. ----------
async function fetchCaltrans() {
  const districts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const lists = await Promise.allSettled(districts.map(d =>
    get(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${String(d).padStart(2, '0')}.json`, { timeout: 20000, tries: 1 })));
  if (lists.every(r => r.status === 'rejected')) throw new Error(lists[0].reason?.message || 'unreachable');
  const out = [];
  for (const r of lists) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value.data || []) {
      const c = item.cctv || {};
      const L = c.location || {};
      const la = +L.latitude, lo = +L.longitude;
      const v = c.imageData?.streamingVideoURL;
      if (c.inService === 'false' || !okCoord(la, lo) || !isHls(v)) continue;
      out.push({ s: 'ca', t: L.locationName || `${L.route || ''} ${L.nearbyPlace || ''}`.trim() || 'Traffic camera', la: round(la), lo: round(lo), k: 'hls', c: 'traffic',
        v, poster: c.imageData?.static?.currentImageURL || '', r: [L.nearbyPlace, L.county, 'California, US'].filter(Boolean).join(', ') });
    }
  }
  return out;
}
async function fetch511([key, base, , region]) {
  const PAGE = 100; // the server caps pages at 100 rows
  const page = start => get(`${base}/List/GetData/Cameras?query=${encodeURIComponent(JSON.stringify({ columns: [{ data: null, name: '' }, { name: 'sortOrder', s: true }], order: [{ column: 1, dir: 'asc' }], start, length: PAGE, search: { value: '' } }))}&lang=en`);
  const first = await page(0);
  const pages = [first];
  const starts = [];
  for (let s = PAGE; s < (first.recordsTotal || 0); s += PAGE) starts.push(s);
  for (let i = 0; i < starts.length; i += 6) pages.push(...await Promise.all(starts.slice(i, i + 6).map(page)));
  const out = [];
  for (const site of pages.flatMap(j => j.data || [])) {
    const m = site.latLng?.geography?.wellKnownText?.match(/POINT \(([-\d.]+) ([-\d.]+)\)/);
    if (!m) continue;
    const lo = +m[1], la = +m[2];
    const img = (site.images || []).find(i => !i.disabled && !i.blocked && !i.videoDisabled && !i.isVideoAuthRequired && isHls(i.videoUrl));
    if (!okCoord(la, lo) || !img) continue;
    const title = [site.location, img.description, site.roadway].map(x => (x || '').trim()).find(x => x && !/^n\/?a$/i.test(x)) || 'Traffic camera';
    out.push({ s: key, t: title, la: round(la), lo: round(lo), k: 'hls', c: 'traffic', v: img.videoUrl, poster: base + img.imageUrl, r: [site.city, region].filter(Boolean).join(', ') });
  }
  return out;
}

// ---------- CARS platform states (Castle Rock) with public HLS ----------
const CARS = [
  ['mn', 'Minnesota 511', 'Minnesota, US', 'https://511mn.org'],
  ['co', 'COtrip', 'Colorado, US', 'https://cotrip.org'],
  ['ia', 'Iowa 511', 'Iowa, US', 'https://511ia.org'],
  ['in', 'INDOT TrafficWise', 'Indiana, US', 'https://511in.org'], // currently fails the health check; kept in case it recovers
];
async function fetchCars([st, , region]) {
  const list = await get(`https://${st}tg.carsprogram.org/cameras_v1/api/cameras`);
  return list.filter(c => c.public !== false && c.active !== false).map(c => {
    const la = c.location?.latitude, lo = c.location?.longitude;
    const vid = (c.views || []).find(v => v.type === 'WMP' && isHls(v.url));
    if (!okCoord(la, lo) || !vid) return null;
    return { s: `cars_${st}`, t: (c.name || 'Traffic camera').trim(), la: round(la), lo: round(lo), k: 'hls', c: 'traffic', v: vid.url, poster: vid.videoPreviewUrl || '', r: [c.location?.routeId, region].filter(Boolean).join(', ') };
  }).filter(Boolean);
}

// ---------- Missouri DOT ----------
async function fetchMissouri() {
  const list = await get('https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json');
  return list.filter(c => okCoord(c.y, c.x) && isHls(c.html)).map(c => ({
    s: 'mo', t: c.location || 'Traffic camera', la: round(c.y), lo: round(c.x), k: 'hls', c: 'traffic', v: c.html, r: 'Missouri, US',
  }));
}

// ---------- Arkansas (iDriveArkansas). Geo-blocks non-US networks. ----------
async function fetchArkansas() {
  const j = await get('https://layers.idrivearkansas.com/cameras.geojson');
  return (j.features || []).map(f => {
    const p = f.properties || {}, [lo, la] = f.geometry?.coordinates || [];
    const v = (p.hls_stream_protected || p.hls_stream || '').replace(/\\\//g, '/');
    if (p.status !== 'online' || !okCoord(la, lo) || !isHls(v)) return null;
    return { s: 'ar', t: p.name?.trim() || 'Traffic camera', la: round(la), lo: round(lo), k: 'hls', c: 'traffic', v, r: [p.route_type_abbr && p.route ? `${p.route_type_abbr} ${p.route}` : '', 'Arkansas, US'].filter(Boolean).join(', ') };
  }).filter(Boolean);
}

// ---------- Maryland CHART. Geo-blocks non-US networks. ----------
// Stream URL pattern taken from CHART's own public video page: https://{cctvIp}/rtplive/{id}/playlist.m3u8
async function fetchMaryland() {
  const list = await get('https://chart.maryland.gov/DataFeeds/GetCamerasJson');
  return (Array.isArray(list) ? list : list.data || []).map(c => {
    if (c.commMode !== 'ONLINE' || c.opStatus !== 'OK' || !okCoord(c.lat, c.lon) || !c.cctvIp || !c.id) return null;
    return { s: 'md', t: c.description || c.name, la: round(c.lat), lo: round(c.lon), k: 'hls', c: 'traffic', v: `https://${c.cctvIp}/rtplive/${c.id}/playlist.m3u8`, r: [c.cameraCategories?.[0], 'Maryland, US'].filter(Boolean).join(', ') };
  }).filter(Boolean);
}

// ---------- webcams.bg: Bulgaria's live-webcam network (~350 cams) ----------
// The site's own map files (/1.map … /4.map) are tab-separated: lat, lon, title (linking to /{id}/{slug}/), town.
// Each camera page then carries its current live stream: <video id="video_stream" src="….m3u8">, an MJPEG
// <img id="mjpeg_stream">, or an <iframe id="iframe_stream">. Pages without any stream element are offline.
async function fetchWebcamsBg() {
  const BASE = 'https://www.webcams.bg';
  const rows = [];
  for (const n of [1, 2, 3, 4]) {
    const tsv = await get(`${BASE}/${n}.map`, { type: 'text' });
    for (const line of tsv.split(/\r?\n/).slice(1)) {
      const [la, lo, titleHtml, town] = line.split('\t');
      const href = titleHtml?.match(/href="(\/\d+\/[^"]+\/)"/)?.[1];
      if (!href || !okCoord(+la, +lo)) continue;
      const title = titleHtml.replace(/<[^>]+>/g, '').trim();
      rows.push({ href, la: +la, lo: +lo, title, town: (town || '').replace(/^(гр|с|к\.к|м|в\.з)\.\s*/, '').trim(), cat: n });
    }
  }
  const attr = (html, id, a) => html.match(new RegExp(`<[^>]*id="${id}"[^>]*\\b${a}="([^"]+)"`, 'i'))?.[1] || html.match(new RegExp(`<[^>]*\\b${a}="([^"]+)"[^>]*id="${id}"`, 'i'))?.[1];
  const out = [];
  let i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const r = rows[i++];
      try {
        const html = await get(BASE + r.href, { type: 'text', tries: 2, timeout: 20000 });
        const hls = attr(html, 'video_stream', 'src');
        const iframe = attr(html, 'iframe_stream', 'src');
        const mjpeg = attr(html, 'mjpeg_stream', 'data-src') || attr(html, 'mjpeg_stream', 'src');
        const poster = attr(html, 'video_stream', 'poster') || attr(html, 'jpeg_stream', 'src') || '';
        const base = { s: 'bg', t: `${r.title}${r.town ? ', ' + r.town : ''}`, la: round(r.la), lo: round(r.lo), c: r.cat === 2 ? 'nature' : 'city', r: `${r.town}, Bulgaria`.replace(/^, /, ''), page: BASE + r.href };
        if (isHls(hls)) out.push({ ...base, k: 'hls', v: hls, poster });
        else if (/^https:\/\//.test(iframe || '') && !/rtsp\.me/i.test(iframe)) out.push({ ...base, k: 'iframe', e: iframe }); // no rtsp.me (owner billing screens)
        else if (/^https:\/\//.test(mjpeg || '')) out.push({ ...base, k: 'mjpeg', m: mjpeg });
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

// ---------- shared: pull a live stream out of a webcam page ----------
// Accepts only streams published through a named service or the owner's own HTTPS domain. Anything addressed by a
// raw IP (e.g. http://212.25.48.117:8080/mjpg/video.mjpg) is skipped: that's the signature of cameras that are
// merely reachable on the internet rather than deliberately published.
const PUBLIC_HOST = u => { try { const x = new URL(u); return x.protocol === 'https:' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(x.hostname) && !x.hostname.includes(':'); } catch { return false; } };
function streamFromHtml(html) {
  const yt = html.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/)?.[1];
  if (yt) return { k: 'yt', yt };
  for (const m of html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)) {
    const src = m[1].replace(/&amp;/g, '&');
    // rtsp.me is deliberately excluded: it bills camera owners, and unpaid cams show a "Debt / Top up" screen
    // in the player. The build can't tell paid from unpaid, and the grid must never show a payment prompt.
    if (/^https:\/\/((?:www\.|g\d\.)?ipcamlive\.com\/player\/|[^/]*earthcam\.(?:com|net)\/|video\.nest\.com\/embed|player\.twitch\.tv)/i.test(src) && PUBLIC_HOST(src)) return { k: 'iframe', e: src };
  }
  for (const m of html.matchAll(/(https:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/gi)) if (isHls(m[1]) && PUBLIC_HOST(m[1])) return { k: 'hls', v: m[1] };
  for (const m of html.matchAll(/(https:\/\/[^"'\s<>]+\/(?:mjpg\/video\.mjpg|[^"'\s<>]*\.mjpe?g))/gi)) if (PUBLIC_HOST(m[1])) return { k: 'mjpeg', m: m[1] };
  return null;
}
const GAZ_BY_COUNTRY = {};
let GAZ_LOADED = false;
async function gazetteerPlace(name, cc) {
  if (!GAZ_LOADED) {
    for (const g of JSON.parse(await readFile(join(ROOT, 'scripts', 'data', 'gazetteer.json'), 'utf8'))) (GAZ_BY_COUNTRY[g.c] ||= []).push(g);
    GAZ_LOADED = true;
  }
  const f = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return (GAZ_BY_COUNTRY[cc] || []).filter(g => g.n.some(n => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === f)).sort((a, b) => b.p - a.p)[0] || null;
}

// ---------- free-webcambg.com: Bulgarian webcam directory (~350 cams, every major town) ----------
// Camera pages are named "{City}-{NN}-…htm". The stream is on the page or one iframe level down.
async function fetchFreeWebcamBg() {
  const BASE = 'http://free-webcambg.com/';
  const home = await get(BASE, { type: 'text' });
  const pages = [...new Set([...home.matchAll(/href="([A-Z][A-Za-z-]+-\d{2,3}[^"]*\.html?)"/g)].map(m => m[1]))];
  const out = [];
  const perCity = {};
  let i = 0;
  const worker = async () => {
    while (i < pages.length) {
      const p = pages[i++];
      try {
        const city = p.match(/^([A-Za-z-]+?)-\d/)[1].replace(/-/g, ' ');
        let html = await get(BASE + p, { type: 'text', tries: 2, timeout: 20000 });
        let s = streamFromHtml(html);
        if (!s) {
          // One level down: the page's own player frame (skip ads, menus and image galleries).
          for (const m of html.matchAll(/<iframe[^>]+src="([^"]+\.html?)"/gi)) {
            if (/^(ad|image|https?:)/i.test(m[1])) continue;
            s = streamFromHtml(await get(BASE + m[1], { type: 'text', tries: 1, timeout: 15000 }).catch(() => ''));
            if (s) break;
          }
        }
        if (!s) continue;
        const g = await gazetteerPlace(city, 'BG');
        if (!g) continue;
        // Several cams per town: fan them out ~300 m apart so each dot is clickable.
        const n = perCity[city] = (perCity[city] ?? -1) + 1;
        const la = g.la + (n ? 0.003 * Math.sin(n * 2.4) : 0), lo = g.lo + (n ? 0.004 * Math.cos(n * 2.4) : 0);
        const label = p.replace(/\.html?$/, '').replace(/-webcam.*$/i, '').replace(/^[A-Za-z]+-\d+-?/, '').replace(/-/g, ' ').trim();
        out.push({ s: 'fwbg', t: `${g.n[0]}${label ? ' · ' + label : ''}`, la: round(la), lo: round(lo), c: 'city', r: `${g.n[0]}, Bulgaria`, page: BASE + p, ...s });
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

// ---------- Delaware DOT ----------
async function fetchDelaware() {
  const j = await get('https://tmc.deldot.gov/json/videocamera.json');
  return (j.videoCameras || []).filter(c => c.enabled !== false && c.status !== 'Unavailable' && okCoord(c.lat, c.lon) && isHls(c.urls?.m3u8s)).map(c => ({
    s: 'de', t: c.title, la: round(c.lat), lo: round(c.lon), k: 'hls', c: 'traffic', v: c.urls.m3u8s, r: `${c.county ? c.county + ' County, ' : ''}Delaware, US`,
  }));
}

// ---------- Windy webcams with a LIVE player (needs a free key: https://api.windy.com/keys) ----------
const WINDY_CATS = { beach: 'beach', city: 'city', mountain: 'nature', lake: 'nature', forest: 'nature', park: 'nature', island: 'nature', coast: 'beach', harbor: 'city', airport: 'transport', traffic: 'traffic', meteo: 'weather', landscape: 'nature', building: 'city', square: 'city', sportarea: 'city', camping: 'nature', pool: 'city', resort: 'nature', water: 'nature', village: 'city', indoor: 'city', underwater: 'nature', animal: 'nature', observatory: 'weather', bay: 'beach', field: 'nature', river: 'nature', golf: 'nature', sky: 'weather' };
async function fetchWindy(key) {
  const headers = { 'x-windy-api-key': key };
  const seen = new Map();
  let scanned = 0;
  // Returns the total match count so callers know whether the 1,050-result paging cap cut them off.
  const grab = async params => {
    let total = 0;
    for (let offset = 0; offset <= 1000; offset += 50) {
      const j = await get(`https://api.windy.com/webcams/api/v3/webcams?limit=50&offset=${offset}&include=location,categories,player&lang=en&${params}`, { headers });
      total = j.total || 0;
      for (const w of j.webcams || []) {
        scanned++;
        const L = w.location || {};
        // Only webcams with a real live stream; Windy's day/month players are timelapses.
        if (w.status !== 'active' || !w.player?.live || seen.has(w.webcamId) || !okCoord(L.latitude, L.longitude)) continue;
        const cat = (w.categories || []).map(c => WINDY_CATS[c.id]).find(Boolean) || 'nature';
        seen.set(w.webcamId, { s: 'windy', t: w.title, la: round(L.latitude), lo: round(L.longitude), k: 'windy', c: cat, w: w.webcamId, wp: w.player.live, r: [L.city, L.region, L.country].filter(Boolean).join(', ') });
      }
      if ((j.webcams || []).length < 50 || offset + 50 >= total) break;
    }
    return total;
  };
  const WINDY_CAT_IDS = Object.keys(WINDY_CATS);
  // The free tier caps paging at offset 1000, so query country by country; countries with more webcams than
  // that are split further by category. Finally sweep whole continents for anything left.
  const country = async cc => {
    const total = await grab(`countries=${cc}&sortKey=popularity&sortDirection=desc`);
    if (total > 1050) for (const cat of WINDY_CAT_IDS) { try { await grab(`countries=${cc}&categories=${cat}`); } catch {} }
  };
  const COUNTRIES = 'US,CA,MX,BR,AR,CL,PE,CO,GB,IE,FR,DE,IT,ES,PT,NL,BE,CH,AT,PL,CZ,SK,HU,SI,HR,RS,BA,ME,AL,GR,TR,RO,BG,UA,NO,SE,FI,DK,IS,EE,LV,LT,JP,KR,CN,TW,HK,TH,VN,MY,SG,ID,PH,IN,NP,LK,AE,IL,EG,MA,ZA,KE,TZ,AU,NZ,FJ,PF,CU,DO,PR,BS,JM,CR,PA,UY,BO,EC,VE,LU,MT,CY,AD,MC,LI,FO,GL,GE,AM,KZ,MN,SA,QA,OM,JO,MV,MU,SC,NA,BW'.split(',');
  for (let i = 0; i < COUNTRIES.length; i += 4) {
    await Promise.all(COUNTRIES.slice(i, i + 4).map(cc => country(cc).catch(e => console.warn(`\n  windy ${cc}: ${e.message}`))));
    process.stdout.write(`\r  windy: ${seen.size} live of ${scanned} scanned (${Math.min(i + 4, COUNTRIES.length)}/${COUNTRIES.length} countries)   `);
  }
  for (const ct of ['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA']) { try { await grab(`continents=${ct}&sortKey=popularity&sortDirection=desc`); } catch {} }
  process.stdout.write('\n');
  return [...seen.values()];
}

// ---------- curated YouTube 24/7 live streams (scripts/curate-youtube.mjs) ----------
async function loadYoutube() {
  try {
    const list = JSON.parse(await readFile(join(ROOT, 'public', 'data', 'youtube.json'), 'utf8'));
    // Strip hashtags, emoji and "LIVE" decorations so titles read like place names.
    const clean = t => t.replace(/#\S+/g, '').replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200B}]/gu, '')
      .replace(/\b(live now|live)\b\s*[:|-]?\s*/gi, '').replace(/[|｜]\s*$/, '').replace(/\s{2,}/g, ' ').replace(/^[\s:|\-–—]+|[\s:|\-–—]+$/g, '').trim();
    // Several streams can share one place: fan them out ~300 m apart so each dot stays clickable.
    const seenAt = {};
    for (const y of list) {
      const k = `${y.la},${y.lo}`, n = seenAt[k] = (seenAt[k] ?? -1) + 1;
      if (n) { const ang = n * 2.4; y.la = round(y.la + 0.003 * Math.sin(ang)); y.lo = round(y.lo + 0.003 * Math.cos(ang) / Math.cos(y.la * Math.PI / 180)); }
    }
    return list.map(y => ({ s: 'yt', t: clean(y.title) || y.place, la: y.la, lo: y.lo, k: 'yt', c: y.c || 'city', yt: y.id, r: y.place }));
  } catch { return []; }
}

// ---------- main ----------
const SOURCES = {
  yt: { name: 'YouTube live streams', url: 'https://www.youtube.com/' },
  windy: { name: 'Windy.com live webcams', url: 'https://www.windy.com/webcams' },
  mo: { name: 'MoDOT Traveler', url: 'https://traveler.modot.org/' },
  de: { name: 'DelDOT', url: 'https://deldot.gov/map/' },
  ca: { name: 'Caltrans QuickMap', url: 'https://quickmap.dot.ca.gov/' },
  ar: { name: 'iDriveArkansas', url: 'https://www.idrivearkansas.com/' },
  md: { name: 'Maryland CHART', url: 'https://chart.maryland.gov/' },
  bg: { name: 'Webcams.bg', url: 'https://www.webcams.bg/' },
  fwbg: { name: 'free-webcambg.com', url: 'http://free-webcambg.com/' },
  ...Object.fromEntries(SITES_511.map(([k, base, name]) => [k, { name, url: base }])),
  ...Object.fromEntries(CARS.map(([st, name, , url]) => [`cars_${st}`, { name, url }])),
};

const jobs = [
  // [label, fetcher, source key]
  ...SITES_511.map(s => [s[2], () => fetch511(s), s[0]]),
  ...CARS.map(c => [c[1], () => fetchCars(c), `cars_${c[0]}`]),
  ['MoDOT', fetchMissouri, 'mo'], ['DelDOT', fetchDelaware, 'de'], ['Caltrans', fetchCaltrans, 'ca'],
  ['iDriveArkansas', fetchArkansas, 'ar'], ['Maryland CHART', fetchMaryland, 'md'],
  ['webcams.bg', fetchWebcamsBg, 'bg'], ['free-webcambg.com', fetchFreeWebcamBg, 'fwbg'],
  ['YouTube (curated)', loadYoutube, 'yt'],
];
// ONLY=bg,fwbg runs just those sources (handy with DRY=1, which reports without writing anything).
if (process.env.ONLY) {
  const only = new Set(process.env.ONLY.split(','));
  for (let i = jobs.length - 1; i >= 0; i--) if (!only.has(jobs[i][2])) jobs.splice(i, 1);
}
// GEO_BLOCKED=ca,ut,… : sources this network can't reach. They're skipped here and their cams are kept from the
// previous build (which `node scripts/merge-remote.mjs` fills from the GitHub US-network build).
const GEO_BLOCKED = new Set((process.env.GEO_BLOCKED || '').split(',').map(s => s.trim()).filter(Boolean));
if (GEO_BLOCKED.size) {
  console.log(`(GEO_BLOCKED: reusing ${[...GEO_BLOCKED].join(', ')} from the previous build)`);
  for (let i = jobs.length - 1; i >= 0; i--) if (GEO_BLOCKED.has(jobs[i][2])) jobs.splice(i, 1);
}
// SKIP_WINDY=1 reuses the Windy cams from the previous build (the full scan takes a while).
if (process.env.SKIP_WINDY) console.log('(SKIP_WINDY set: reusing Windy cams from the previous build)');
else if (process.env.WINDY_API_KEY) jobs.push(['Windy (live only)', () => fetchWindy(process.env.WINDY_API_KEY)]);
else console.log('(WINDY_API_KEY not set: skipping Windy. Free key at https://api.windy.com/keys)');

let previous = null;
try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

const results = await Promise.all(jobs.map(async ([label, fn]) => {
  const t0 = Date.now();
  try { const cams = await fn(); console.log(`✔ ${label.padEnd(22)} ${String(cams.length).padStart(6)} live  (${((Date.now() - t0) / 1000).toFixed(1)}s)`); return cams; }
  catch (e) { console.log(`✘ ${label.padEnd(22)} failed: ${e.message}`); return null; }
}));
let cams = results.flatMap(r => r || []);

// A source that is down (or blocks this network) keeps its cameras from the previous build.
// (Not in ONLY mode: that run is about the selected sources alone.)
if (previous?.cams && !process.env.ONLY) {
  const have = new Set(cams.map(c => c.s));
  const keepOld = previous.cams.filter(c => !have.has(c.s) && SOURCES[c.s] && ['hls', 'yt', 'windy', 'iframe', 'mjpeg'].includes(c.k));
  if (keepOld.length) { cams = cams.concat(keepOld); console.log(`↺ kept ${keepOld.length} cams from the previous build for sources that failed this time`); }
}

// ---------- stream health check ----------
// Request every HLS playlist the way a browser would (with an Origin header). Drop streams that answer with an
// error or without CORS permission: those can never play on the site. Streams that simply time out are kept,
// because that usually means *this* network is blocked (several US DOTs geo-block), not that the stream is down.
async function healthCheck(list) {
  // Sources in GEO_BLOCKED were verified from a US network; this network would wrongly fail them.
  const hls = list.filter(c => c.k === 'hls' && !GEO_BLOCKED.has(c.s));
  const bad = new Set();
  let unknown = 0, i = 0;
  const worker = async () => {
    while (i < hls.length) {
      const c = hls[i++];
      try {
        const res = await fetch(c.v, { headers: { 'User-Agent': UA, Origin: 'https://lookout.example' }, signal: AbortSignal.timeout(10000) });
        const cors = res.headers.get('access-control-allow-origin');
        const body = res.ok ? await res.text() : '';
        if (!res.ok || !cors || !body.startsWith('#EXTM3U')) bad.add(c);
      } catch { unknown++; }
    }
  };
  await Promise.all(Array.from({ length: 32 }, worker));
  console.log(`Health check: ${hls.length - bad.size - unknown} streams OK, ${bad.size} dead or not browser-playable (dropped), ${unknown} unreachable from here (kept).`);
  return list.filter(c => !bad.has(c));
}
if (!process.env.SKIP_HEALTH) cams = await healthCheck(cams);

// ---------- de-duplicate ----------
// Same stream listed twice, and traffic cams every few hundred metres along one road (same view over and over):
// keep one traffic cam per MIN_SPACING_KM. YouTube and Windy streams are never thinned.
const MIN_SPACING_KM = Number(process.env.MIN_SPACING_KM ?? 1.0);
const seenMedia = new Set();
cams = cams.filter(c => {
  const key = String(c.yt || c.w || c.v || c.e || c.m).replace(/[?#].*$/, '').toLowerCase();
  if (seenMedia.has(key)) return false;
  seenMedia.add(key);
  return true;
});
const CELL = Math.max(MIN_SPACING_KM, 0.05) / 111;
const grid = new Map();
const km = (a, b) => {
  const r = Math.PI / 180, dLa = (b.la - a.la) * r, dLo = (b.lo - a.lo) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.la * r) * Math.cos(b.la * r) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const kept = [];
let dropped = 0;
for (const c of cams) {
  if (c.c === 'traffic' && MIN_SPACING_KM > 0) {
    const ci = Math.floor(c.la / CELL), cj = Math.floor(c.lo / CELL);
    const span = Math.min(40, Math.ceil(1 / Math.max(0.05, Math.cos(c.la * Math.PI / 180))));
    let crowded = false;
    for (let i = ci - 1; i <= ci + 1 && !crowded; i++)
      for (let j = cj - span; j <= cj + span && !crowded; j++)
        for (const o of grid.get(`${i}:${j}`) || []) if (km(c, o) < MIN_SPACING_KM) { crowded = true; break; }
    if (crowded) { dropped++; continue; }
    const k = `${ci}:${cj}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
  }
  kept.push(c);
}
console.log(`De-dup: dropped ${dropped} same-road repeats (< ${MIN_SPACING_KM} km apart).`);
cams = kept;

if (process.env.DRY) {
  const fresh = cams.filter(c => process.env.ONLY?.split(',').includes(c.s));
  console.log(`\nDRY run, nothing written. ${fresh.length} cams from ${process.env.ONLY || 'all sources'}:`);
  for (const c of fresh.slice(0, 400)) console.log(`  [${c.s}] ${c.k.padEnd(6)} ${c.t.slice(0, 50).padEnd(50)} ${c.v || c.e || c.m || c.yt || ''}`);
  process.exit(0);
}
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ built: new Date().toISOString(), sources: SOURCES, cams }));
const by = {};
for (const c of cams) by[c.k] = (by[c.k] || 0) + 1;
console.log(`\nWrote ${cams.length} live cameras → ${OUT}   ${JSON.stringify(by)}`);
