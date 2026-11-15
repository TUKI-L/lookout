// Sweeps YouTube for 24/7 live cameras country by country, in each country's own language, and places every
// stream on the globe by finding a known place name in its title (multilingual gazetteer from Natural Earth).
// Streams whose title names no recognisable place in that country are skipped rather than guessed.
// New finds are APPENDED to public/data/youtube.json.
//   node scripts/sweep-youtube.mjs            (takes ~1 hour: YouTube rate-limits searches)
//   node scripts/sweep-youtube.mjs JP KR      (only these countries)

import { writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'data', 'youtube.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const GAZ = JSON.parse(await readFile(join(HERE, 'data', 'gazetteer.json'), 'utf8'));
// Korean/Japanese/Chinese admin suffixes hide the bare name people put in titles (부산광역시 → 부산).
for (const g of GAZ) for (const n of [...g.n]) {
  const bare = n.replace(/(광역시|특별시|특별자치시|특별자치도|시|도|군|구|都|府|県|市|区|町|省|自治区)$/, '');
  if (bare !== n && bare.length >= 2 && !g.n.includes(bare)) g.n.push(bare);
}
// Famous districts and spots that streams name instead of their city (each with its own coordinates).
const ALIASES = [
  [['渋谷', 'Shibuya', '시부야'], 'JP', 35.6595, 139.7005], [['新宿', 'Shinjuku', '歌舞伎町', 'Kabukicho'], 'JP', 35.6938, 139.7034],
  [['池袋', 'Ikebukuro'], 'JP', 35.7295, 139.7109], [['秋葉原', 'Akihabara'], 'JP', 35.6984, 139.7731], [['浅草', 'Asakusa'], 'JP', 35.7148, 139.7967],
  [['銀座', 'Ginza'], 'JP', 35.6717, 139.765], [['お台場', 'Odaiba'], 'JP', 35.6267, 139.7752], [['東京スカイツリー', 'Skytree'], 'JP', 35.7101, 139.8107],
  [['道頓堀', 'Dotonbori', '難波', 'Namba'], 'JP', 34.6687, 135.5013], [['梅田', 'Umeda'], 'JP', 34.7055, 135.4983], [['祇園', 'Gion'], 'JP', 35.0037, 135.7788],
  [['すすきの', 'Susukino'], 'JP', 43.0556, 141.3533], [['富士山', 'Mt. Fuji', 'Mount Fuji', '河口湖'], 'JP', 35.3606, 138.7274], [['桜島', 'Sakurajima'], 'JP', 31.5809, 130.6571],
  [['해운대', 'Haeundae'], 'KR', 35.1587, 129.1604], [['광안리', 'Gwangalli'], 'KR', 35.1532, 129.1186], [['강남', 'Gangnam'], 'KR', 37.4979, 127.0276],
  [['명동', 'Myeongdong'], 'KR', 37.5636, 126.9826], [['한강', 'Hangang', 'Han River'], 'KR', 37.5283, 126.9326], [['제주', 'Jeju'], 'KR', 33.4996, 126.5312],
  [['Waikiki'], 'US', 21.2793, -157.8292], [['Times Square'], 'US', 40.758, -73.9855], [['Las Vegas Strip', 'Fremont Street'], 'US', 36.1147, -115.1728],
  [['Copacabana'], 'BR', -22.9711, -43.1822], [['Ipanema'], 'BR', -22.9868, -43.2026], [['Balneário Camboriú', 'Balneario Camboriu'], 'BR', -26.9906, -48.6347],
  [['Benidorm'], 'ES', 38.5411, -0.1225], [['Ibiza', 'Eivissa'], 'ES', 38.9067, 1.4206], [['Tenerife'], 'ES', 28.2916, -16.6291], [['Mallorca', 'Majorca'], 'ES', 39.6953, 3.0176],
  [['Rimini'], 'IT', 44.0678, 12.5695], [['Amalfi', 'Positano'], 'IT', 40.6281, 14.4849], [['Cortina'], 'IT', 46.5405, 12.1357], [['Sylt'], 'DE', 54.9079, 8.3175], [['Zugspitze'], 'DE', 47.4211, 10.9853],
];
for (const [n, c, la, lo] of ALIASES) GAZ.push({ n, c, a: GAZ.find(g => g.c === c)?.a || c, la, lo, p: 1 });
let existing = [];
try { existing = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
const used = new Set(existing.map(e => e.id));

// ---------- queries ----------
// Local-language words for "live camera" per country. Every country also gets English queries with its name.
const LOCAL = {
  JP: ['ライブカメラ', 'ライブカメラ 24時間', 'ライブカメラ 海', 'ライブカメラ 駅', 'ライブカメラ 道路', 'ライブカメラ 山', 'ライブカメラ 港', 'ライブカメラ 空港', 'ライブカメラ 川', 'ライブカメラ 温泉', 'ライブカメラ 雪', 'ライブカメラ 桜'],
  KR: ['라이브캠', '실시간 라이브캠', '해수욕장 라이브캠', '실시간 CCTV 라이브', '라이브 카메라 24시간'],
  TW: ['即時影像 直播', '即時 攝影機 直播', '台灣 live cam'],
  HK: ['香港 直播 鏡頭'], CN: ['直播 实时 摄像头'],
  TH: ['กล้องสด ไลฟ์', 'live cam Thailand'], VN: ['camera trực tiếp', 'live cam Việt Nam'], ID: ['live cctv', 'kamera live'], PH: ['live cam Philippines'],
  ES: ['cámara en directo', 'webcam en directo', 'webcam playa en directo'], MX: ['cámara en vivo México', 'webcam en vivo México'],
  AR: ['cámara en vivo Argentina'], CO: ['cámara en vivo Colombia'], CL: ['cámara en vivo Chile'], PE: ['cámara en vivo Perú'],
  UY: ['cámara en vivo Uruguay'], EC: ['cámara en vivo Ecuador'], CR: ['cámara en vivo Costa Rica'], DO: ['cámara en vivo República Dominicana'],
  BR: ['câmera ao vivo', 'câmera ao vivo praia', 'webcam ao vivo'], PT: ['câmara em direto', 'webcam em direto'],
  DE: ['Webcam live', 'Livecam', 'Webcam live Hafen', 'Webcam live Bahnhof'], AT: ['Webcam live Österreich'], CH: ['Webcam live Schweiz'],
  FR: ['webcam en direct', 'caméra en direct'], BE: ['webcam live België'], NL: ['webcam live', 'livestream webcam Nederland'],
  IT: ['webcam in diretta', 'diretta webcam 24', 'webcam live Italia'],
  PL: ['kamera na żywo', 'kamera online na żywo'], CZ: ['webkamera živě'], SK: ['webkamera naživo'], HU: ['élő kamera', 'webkamera élő'],
  HR: ['kamera uživo'], RS: ['kamera uživo Srbija'], SI: ['spletna kamera v živo'], RO: ['camera live România'], BG: ['камера на живо'],
  GR: ['live κάμερα', 'live webcam Greece'], TR: ['canlı kamera', 'canlı yayın kamera', 'canlı mobese'],
  RU: ['веб камера онлайн', 'камера онлайн трансляция'], UA: ['веб камера онлайн Україна', 'live cam Ukraine'],
  SE: ['webbkamera live'], NO: ['webkamera direkte'], DK: ['webcam live Danmark'], FI: ['live kamera', 'webkamera suora'], IS: ['vefmyndavél beint'],
  IL: ['מצלמה חיה', 'live cam Israel'], SA: ['بث مباشر كاميرا'], AE: ['live cam Dubai'], EG: ['بث مباشر كاميرا مصر'],
};
const COUNTRIES = [...new Set(GAZ.filter(g => g.p >= 300000).map(g => g.c))];
const countryName = cc => GAZ.find(g => g.c === cc)?.a || cc;
const onlyArgs = process.argv.slice(2).filter(a => /^[A-Z]{2}$/.test(a));
const queries = [];
for (const cc of (onlyArgs.length ? onlyArgs : COUNTRIES)) {
  const name = countryName(cc);
  for (const q of [`${name} live cam`, `${name} webcam live 24/7`]) queries.push([cc, q]);
  for (const q of LOCAL[cc] || []) queries.push([cc, q]);
}
// Japan has by far the most 24/7 YouTube cameras: add a query per city.
if (!onlyArgs.length || onlyArgs.includes('JP')) {
  for (const g of GAZ.filter(g => g.c === 'JP' && g.p >= 150000)) {
    const ja = g.n.find(n => /[぀-ヿ㐀-鿿]/.test(n));
    if (ja) queries.push(['JP', `${ja.replace(/(都|府|県|市)$/, '')} ライブカメラ`]);
  }
}

// ---------- geocoding by title ----------
const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const isCjk = s => /[぀-ヿ㐀-鿿가-힯]/.test(s);
const byCountry = {};
for (const g of GAZ) (byCountry[g.c] ||= []).push(g);
function geocode(text, cc) {
  const t = fold(text);
  let best = null, bestLen = 0;
  for (const g of byCountry[cc] || []) {
    for (const n of g.n) {
      const f = fold(n);
      const hit = isCjk(n) ? t.includes(f) : new RegExp(`(^|[^\\p{L}])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(t);
      // Prefer the longest (most specific) name; break ties by population.
      if (hit && (f.length > bestLen || (f.length === bestLen && g.p > (best?.p || 0)))) { best = g; bestLen = f.length; }
    }
  }
  return best;
}
function category(title) {
  const t = fold(title);
  if (/beach|playa|praia|strand|plage|spiaggia|plaza de playa|해수욕장|ビーチ|海水浴|surf/.test(t)) return 'beach';
  if (/airport|aeropuerto|aeroporto|flughafen|aeroport|空港|공항|planespotting|railcam|train|駅|鉄道|新幹線|harbou?r|port of|hafen|porto|puerto|港|ship|ferry|canal/.test(t)) return 'transport';
  if (/zoo|wildlife|animal|bird|nest|eagle|bear|safari|aquarium|volcano|vulkan|vulcano|火山|ski|mountain|berg|montagna|山|lake|see |lago|river|川|falls|forest|nature|snow|雪/.test(t)) return 'nature';
  if (/traffic|highway|autobahn|motorway|道路|高速|cctv|mobese|交通/.test(t)) return 'traffic';
  if (/aurora|northern lights|weather|sky|wetter|tempo|météo/.test(t)) return 'weather';
  return 'city';
}

// ---------- YouTube ----------
const BAD = /walk|散歩|歩き|driving|drive |dashcam|radio|lofi|lo-fi|music|news|ニュース|뉴스|noticias|replay|highlights|recorded|timelapse|time-lapse|game|gta|minecraft|asmr|church service|mass |misa |sermon|podcast|talk show|gameplay/i;
async function search(q) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgJAAQ%253D%253D', {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
      });
      const m = (await res.text()).match(/var ytInitialData = (\{.*?\});<\/script>/s);
      if (!m) return [];
      const vids = [];
      JSON.stringify(JSON.parse(m[1]), (k, v) => { if (k === 'videoRenderer') vids.push(v); return v; });
      return vids.map(v => ({
        id: v.videoId, title: (v.title?.runs || []).map(r => r.text).join(''), channel: v.ownerText?.runs?.[0]?.text || '',
        live: (v.badges || []).some(b => /LIVE/i.test(b.metadataBadgeRenderer?.label || '')) || /watching/.test(JSON.stringify(v.viewCountText || '')),
      }));
    } catch (e) { if (attempt === 4) throw e; await sleep(4000 * attempt); }
  }
}
const embeddable = async id => (await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { headers: { 'User-Agent': UA } })).ok;

// ---------- run ----------
console.log(`Sweeping ${queries.length} queries across ${new Set(queries.map(q => q[0])).size} countries…`);
const found = [];
let n = 0;
const save = async () => writeFile(OUT, JSON.stringify(existing.concat(found), null, 1));
for (const [cc, q] of queries) {
  n++;
  try {
    for (const v of (await search(q)).filter(v => v.live && !BAD.test(v.title) && !used.has(v.id))) {
      const g = geocode(`${v.title} ${v.channel}`, cc);
      if (!g) continue;
      if (!(await embeddable(v.id))) { used.add(v.id); continue; }
      used.add(v.id);
      const place = `${g.n[0]}, ${g.a}`;
      found.push({ id: v.id, title: v.title.slice(0, 120), channel: v.channel, place, la: g.la, lo: g.lo, c: category(v.title), src: 'sweep' });
      console.log(`✔ [${cc}] ${place.slice(0, 28).padEnd(28)} ${v.id}  ${v.title.slice(0, 60)}`);
    }
  } catch (e) { console.log(`✘ [${cc}] "${q}": ${e.message}`); }
  if (n % 25 === 0) { await save(); console.log(`… ${n}/${queries.length} queries, ${found.length} new streams so far`); }
  await sleep(1300);
}
await save();
console.log(`\nSweep added ${found.length} new streams; youtube.json now has ${existing.length + found.length}.`);
