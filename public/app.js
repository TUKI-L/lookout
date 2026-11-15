/* Lookout: a globe of public LIVE cameras.
   Data comes from data/cameras.json (built by scripts/build-cameras.mjs). Every camera is a live stream:
   HLS video from transportation departments, YouTube live streams, or Windy live webcams.
   Streams load straight from each publisher in the viewer's browser. */
(() => {
  'use strict';

  const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const HLS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
  const TOUR_DWELL_MS = 18000;   // time spent on each auto-tour stop
  const CONNECT_TIMEOUT_MS = 45000; // DOT streams use ~10 s segments; far from the source the first frame can take a while
  const PIN_LIMIT = 16;

  const CATS = {
    traffic:   { label: 'Traffic',   color: '#4fe3d4' },
    city:      { label: 'City',      color: '#ffb547' },
    nature:    { label: 'Nature',    color: '#8bdc6e' },
    beach:     { label: 'Beach',     color: '#ff8fb1' },
    weather:   { label: 'Sky',       color: '#7ea8ff' },
    transport: { label: 'Transport', color: '#c59bff' },
  };
  const FEED_LABEL = { hls: 'HLS live video', yt: 'YouTube live', windy: 'Windy live' };

  // ---------- tiny helpers ----------
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('lookout.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('lookout.' + k, JSON.stringify(v)); } catch {} },
  };
  const toRad = d => d * Math.PI / 180;
  function distKm(a, b) {
    const dLa = toRad(b.la - a.la), dLo = toRad(b.lo - a.lo);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(a.la)) * Math.cos(toRad(b.la)) * Math.sin(dLo / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  const fmtKm = d => d < 1 ? `${Math.round(d * 1000)} m` : d < 100 ? `${d.toFixed(1)} km` : `${Math.round(d)} km`;
  function dms(v, pos, neg) {
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 3600 - m * 60).toFixed(0);
    return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″${v >= 0 ? pos : neg}`;
  }
  let toastTimer;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2200); }
  const camKey = c => `${c.s}:${c.yt || c.w || c.v}`;

  // ---------- state ----------
  const state = {
    cams: [], sources: {}, byKey: new Map(),
    cats: new Set(store.get('cats', Object.keys(CATS))),
    srcs: null,
    visible: [], selected: -1, pins: store.get('pins', []),
    tour: false, tourTimer: null,
    offline: new Set(), // streams that failed this session; teleport/tour skip them
  };

  // ---------- map ----------
  const map = new maplibregl.Map({
    container: 'map', style: STYLE_URL, center: [-40, 28], zoom: 1.7, maxPitch: 70,
    // Windy's terms ask for this credit wherever its webcams appear.
    attributionControl: { compact: true, customAttribution: 'Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener">windy.com</a>' },
    renderWorldCopies: false,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  // If the page loads in a hidden tab the container measures 0×0 and the canvas sticks at a fallback size.
  new ResizeObserver(() => map.resize()).observe($('map'));

  map.on('style.load', () => {
    try { map.setProjection({ type: 'globe' }); } catch (e) { console.warn('globe projection unavailable', e); }
    try {
      map.setSky({
        'sky-color': '#03070a', 'horizon-color': '#0b2a2f', 'fog-color': '#03070a',
        'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.9,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.85, 5, 0.4, 8, 0],
      });
    } catch {}
    const paint = (id, prop, val) => { if (map.getLayer(id)) try { map.setPaintProperty(id, prop, val); } catch {} };
    paint('background', 'background-color', '#071014');
    paint('water', 'fill-color', '#030a0d');
    paint('boundary_country_outline', 'line-color', '#1d4048');
    paint('boundary_country_inner', 'line-color', '#1d4048');
    for (const l of map.getStyle().layers) {
      if (l.type === 'symbol') { paint(l.id, 'text-color', '#5f8a87'); paint(l.id, 'text-halo-color', '#02070a'); }
    }
  });

  // ---------- data ----------
  async function loadData() {
    const res = await fetch('data/cameras.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`cameras.json: HTTP ${res.status}`);
    const data = await res.json();
    state.sources = data.sources;
    state.cams = data.cams.map((c, i) => {
      c.i = i;
      if (!CATS[c.c]) c.c = 'city';
      c.search = `${c.t} ${c.r || ''} ${data.sources[c.s]?.name || ''}`.toLowerCase();
      state.byKey.set(camKey(c), c);
      return c;
    });
    const all = Object.keys(data.sources);
    const saved = store.get('srcs', null), known = store.get('knownSrcs', []);
    state.srcs = new Set(saved ? saved.filter(s => data.sources[s]) : all);
    for (const s of all) if (!known.includes(s)) state.srcs.add(s); // sources added since last visit start on
    store.set('knownSrcs', all);
  }

  function geojson() {
    return {
      type: 'FeatureCollection',
      features: state.cams.map(c => ({
        type: 'Feature', id: c.i,
        geometry: { type: 'Point', coordinates: [c.lo, c.la] },
        properties: { c: c.c, s: c.s, yt: c.k === 'hls' ? 0 : 1 },
      })),
    };
  }
  const colorExpr = ['match', ['get', 'c'], ...Object.entries(CATS).flatMap(([k, v]) => [k, v.color]), '#4fe3d4'];

  function addLayers() {
    map.addSource('cams', { type: 'geojson', data: geojson() });
    map.addLayer({ id: 'cams-glow', type: 'circle', source: 'cams', paint: {
      'circle-color': colorExpr, 'circle-blur': 1, 'circle-opacity': 0.4,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['==', ['get', 'yt'], 1], 8, 4], 6, ['case', ['==', ['get', 'yt'], 1], 15, 9], 12, 20],
    } });
    map.addLayer({ id: 'cams-dot', type: 'circle', source: 'cams', paint: {
      'circle-color': colorExpr,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['==', ['get', 'yt'], 1], 2.8, 1.6], 6, ['case', ['==', ['get', 'yt'], 1], 5, 3.4], 12, 7],
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, ['boolean', ['feature-state', 'off'], false], 0, 1],
      'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffffff', '#e9fffb'],
      'circle-opacity': ['case', ['boolean', ['feature-state', 'off'], false], 0.25, 0.95],
    } });
    map.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'sel-ring', type: 'circle', source: 'sel', paint: {
      'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ffb547', 'circle-stroke-width': 2, 'circle-stroke-opacity': 1,
    } });
    map.addLayer({ id: 'sel-core', type: 'circle', source: 'sel', paint: { 'circle-radius': 4, 'circle-color': '#ffb547' } });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) animateRing();
  }
  function animateRing() {
    const t = (performance.now() % 1800) / 1800;
    if (map.getLayer('sel-ring')) {
      map.setPaintProperty('sel-ring', 'circle-radius', 6 + t * 22);
      map.setPaintProperty('sel-ring', 'circle-stroke-opacity', 1 - t);
    }
    requestAnimationFrame(animateRing);
  }

  // ---------- filters ----------
  const passes = c => state.cats.has(c.c) && state.srcs.has(c.s);
  function applyFilters(persist = true) {
    const filter = ['all', ['in', ['get', 'c'], ['literal', [...state.cats]]], ['in', ['get', 's'], ['literal', [...state.srcs]]]];
    for (const id of ['cams-glow', 'cams-dot']) if (map.getLayer(id)) map.setFilter(id, filter);
    state.visible = state.cams.filter(passes);
    $('statShown').textContent = state.visible.length.toLocaleString();
    // Don't save the auto-hidden (unreachable) sources as the viewer's own choice.
    if (persist) { store.set('cats', [...state.cats]); store.set('srcs', [...new Set([...state.srcs, ...(state.unreachable || [])])]); }
    const counts = {};
    for (const c of state.cams) if (state.srcs.has(c.s)) counts[c.c] = (counts[c.c] || 0) + 1;
    document.querySelectorAll('.chip').forEach(ch => (ch.querySelector('.n').textContent = (counts[ch.dataset.cat] || 0).toLocaleString()));
  }
  function renderFilters() {
    const counts = {};
    for (const c of state.cams) counts[c.c] = (counts[c.c] || 0) + 1;
    $('catChips').replaceChildren(...Object.entries(CATS).filter(([k]) => counts[k]).map(([k, v]) =>
      el('button', { class: 'chip', 'aria-pressed': String(state.cats.has(k)), 'data-cat': k, onclick: e => {
        state.cats.has(k) ? state.cats.delete(k) : state.cats.add(k);
        if (!state.cats.size) state.cats.add(k); // never filter everything out by accident
        e.currentTarget.setAttribute('aria-pressed', String(state.cats.has(k)));
        applyFilters();
      } }, el('span', { class: 'dot', style: `color:${v.color}` }), v.label, el('span', { class: 'n' }, ''))));

    const srcCounts = {};
    for (const c of state.cams) srcCounts[c.s] = (srcCounts[c.s] || 0) + 1;
    const keys = Object.keys(state.sources).filter(k => srcCounts[k]).sort((a, b) => srcCounts[b] - srcCounts[a]);
    $('srcList').replaceChildren(...keys.map(k => el('li', {}, el('label', {},
      el('input', { type: 'checkbox', checked: state.srcs.has(k), onchange: e => { e.target.checked ? state.srcs.add(k) : state.srcs.delete(k); applyFilters(); } }),
      el('span', {}, state.sources[k].name, state.unreachable?.has(k) ? el('span', { class: 'dim' }, ' · blocked on your network') : null),
      el('span', { class: 'n' }, srcCounts[k].toLocaleString())))));
    $('srcCount').textContent = `${keys.length} feeds`;
    const setAll = on => { for (const k of keys) on ? state.srcs.add(k) : state.srcs.delete(k);
      document.querySelectorAll('#srcList input').forEach(i => (i.checked = on)); applyFilters(); };
    $('srcAll').onclick = () => setAll(true);
    $('srcNone').onclick = () => setAll(false);
  }

  // ---------- live player (shared by viewer and wall) ----------
  let hlsPromise;
  const loadHls = () => hlsPromise ||= new Promise((ok, fail) => {
    const s = el('script', { src: HLS_URL }); s.onload = () => ok(window.Hls); s.onerror = fail; document.head.append(s);
  });

  function markOffline(cam) {
    state.offline.add(cam.i);
    map.setFeatureState({ source: 'cams', id: cam.i }, { off: true });
  }

  /** Builds a live player for a camera. Returns { node, destroy }. onOffline(cam) runs if the stream won't play. */
  function playerFor(cam, { compact = false, onOffline } = {}) {
    const box = el('div', { class: 'media loading' });
    const tag = el('span', { class: 'hud-line' });
    const timers = [];
    let hls = null, dead = false, failed = false;

    const offline = why => {
      if (failed || dead) return; failed = true;
      if (hls) { hls.destroy(); hls = null; }
      markOffline(cam);
      box.classList.remove('loading');
      box.replaceChildren(el('div', { class: 'msg' }, el('div', {},
        el('b', {}, 'Stream offline'),
        el('span', {}, why || 'This camera is not streaming right now.'),
        onOffline && !compact ? el('div', { class: 'msg-actions' }, el('button', { class: 'btn primary', onclick: () => onOffline(cam) }, 'Next live cam')) : null)));
      onOffline && compact === false && state.tour && onOffline(cam);
    };
    const iframe = src => {
      const f = el('iframe', { src, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', title: cam.t });
      f.onload = () => box.classList.remove('loading');
      box.append(f);
    };

    if (cam.k === 'yt') {
      iframe(`https://www.youtube-nocookie.com/embed/${cam.yt}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`);
    } else if (cam.k === 'windy') {
      iframe(cam.wp || `https://webcams.windy.com/webcams/public/embed/player/${cam.w}/live`);
    } else {
      // Poster-first: the camera's preview frame shows while the stream connects.
      const video = el('video', { autoplay: true, muted: true, playsinline: true, controls: !compact, poster: cam.poster || false });
      video.muted = true;
      video.onplaying = () => { box.classList.remove('loading'); tag.textContent = 'LIVE'; tag.classList.add('live'); };
      tag.textContent = 'CONNECTING…';
      box.append(video, tag);
      const native = () => {
        if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = cam.v; video.onerror = () => offline(); }
        else offline('Your browser cannot play this stream.');
      };
      // Prefer hls.js wherever Media Source Extensions exist: some Chromium builds claim native HLS
      // support but fail to play it. Native playback is the path for iPhone Safari.
      if (!window.MediaSource && !window.ManagedMediaSource) native();
      else loadHls().then(Hls => {
        if (dead) return;
        if (!Hls.isSupported()) return native();
        hls = new Hls({ maxBufferLength: 12, liveSyncDurationCount: 1, manifestLoadingTimeOut: 15000, fragLoadingTimeOut: 30000 });
        hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) offline(d.type === 'networkError' ? 'The stream server did not answer.' : null); });
        hls.loadSource(cam.v); hls.attachMedia(video);
        video.play().catch(() => {});
      }).catch(() => offline('Could not load the video player.'));
      timers.push(setTimeout(() => { if (video.isConnected && video.readyState < 2) offline('No video arrived within 45 seconds.'); }, CONNECT_TIMEOUT_MS));
    }

    return {
      node: box,
      destroy() {
        dead = true;
        timers.forEach(clearTimeout);
        if (hls) hls.destroy();
        box.querySelectorAll('video').forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
        box.replaceChildren();
      },
    };
  }

  // ---------- per-viewer reachability ----------
  // Some state DOTs geo-block foreign networks. Shortly after load, test-fetch two playlists per traffic
  // source from the viewer's own browser; sources that can't be reached are hidden for this viewer only.
  state.unreachable = new Set();
  async function probeSources() {
    const bySrc = {};
    for (const c of state.cams) if (c.k === 'hls') (bySrc[c.s] ||= []).push(c);
    const ok = async c => {
      try { const r = await fetch(c.v, { signal: AbortSignal.timeout(7000), cache: 'no-store' }); return r.ok && (await r.text()).startsWith('#EXTM3U'); }
      catch { return false; }
    };
    await Promise.all(Object.entries(bySrc).map(async ([s, list]) => {
      const sample = [list[Math.floor(list.length * 0.25)], list[Math.floor(list.length * 0.75)]];
      const results = await Promise.all(sample.map(ok));
      if (!results.some(Boolean)) state.unreachable.add(s);
    }));
    if (!state.unreachable.size) return;
    let hidden = 0;
    for (const s of state.unreachable) { state.srcs.delete(s); hidden += bySrc[s].length; }
    applyFilters(false);
    renderFilters();
    toast(`Hid ${hidden.toLocaleString()} cams your network can't reach (${[...state.unreachable].map(s => state.sources[s]?.name || s).join(', ')})`);
  }

  // ---------- viewer ----------
  let viewerPlayer = null;
  function select(i, { fly = true, fromTour = false } = {}) {
    const cam = state.cams[i];
    if (!cam) return;
    if (!fromTour) stopTour();
    state.selected = i;
    map.getSource('sel')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [cam.lo, cam.la] }, properties: {} }] });
    if (fly) map.flyTo({ center: [cam.lo, cam.la], zoom: Math.max(map.getZoom(), cam.k === 'hls' ? 11.5 : 10), speed: fromTour ? 0.9 : 1.4, curve: 1.6, essential: true });

    const cat = CATS[cam.c];
    $('vKind').replaceChildren(el('span', { class: 'dot', style: `color:${cat.color}` }), `${cat.label} · `, el('span', { class: 'live' }, 'Live'));
    $('vTitle').textContent = cam.t;
    $('vRegion').textContent = cam.r || '';
    $('vPos').textContent = `${dms(cam.la, 'N', 'S')} ${dms(cam.lo, 'E', 'W')}`;
    $('vFeed').textContent = FEED_LABEL[cam.k];
    const src = state.sources[cam.s] || { name: cam.s, url: '#' };
    $('vSrc').textContent = src.name;
    $('vSrc').href = cam.k === 'yt' ? `https://www.youtube.com/watch?v=${cam.yt}` : cam.k === 'windy' ? `https://www.windy.com/webcams/${cam.w}` : src.url;

    showPlayer(cam);
    renderPinButton();
    renderNearby(cam);
    $('viewer').hidden = false;
    history.replaceState(null, '', '#cam=' + encodeURIComponent(camKey(cam)));
  }
  function showPlayer(cam) {
    viewerPlayer?.destroy();
    viewerPlayer = playerFor(cam, { onOffline: skipFrom });
    $('vMedia').replaceChildren(viewerPlayer.node);
  }
  // When a stream is down, hop to the nearest working one (or a random one if nothing is near).
  function skipFrom(cam) {
    if (state.tour) { clearTimeout(state.tourTimer); state.tourTimer = setTimeout(tourStep, 1500); return; }
    const next = nearby(cam, 1)[0]?.[0] || randomCam();
    if (next) select(next.i);
  }
  function nearby(cam, n = 6) {
    const pool = state.visible.length ? state.visible : state.cams;
    return pool.filter(c => c !== cam && !state.offline.has(c.i) && Math.abs(c.la - cam.la) < 18)
      .map(c => [c, distKm(cam, c)]).filter(([, d]) => d < 2500).sort((a, b) => a[1] - b[1]).slice(0, n);
  }
  function renderNearby(cam) {
    const list = nearby(cam);
    $('vNear').replaceChildren(...list.map(([c, d]) => el('li', {}, el('button', { onclick: () => select(c.i) },
      el('span', { class: 'dot', style: `color:${CATS[c.c].color}` }), el('span', { class: 't' }, c.t), el('span', { class: 'd' }, fmtKm(d))))));
    $('vNear').parentElement.hidden = !list.length;
  }
  function closeViewer() {
    viewerPlayer?.destroy(); viewerPlayer = null;
    $('viewer').hidden = true; state.selected = -1;
    map.getSource('sel')?.setData({ type: 'FeatureCollection', features: [] });
    history.replaceState(null, '', location.pathname + location.search);
  }

  // ---------- pins / wall ----------
  const isPinned = cam => state.pins.includes(camKey(cam));
  function renderPinButton() {
    const cam = state.cams[state.selected]; if (!cam) return;
    const b = $('vPin'); const on = isPinned(cam);
    b.textContent = on ? 'Pinned ✓' : 'Pin to wall'; b.classList.toggle('on', on);
  }
  function togglePin(cam) {
    const k = camKey(cam);
    if (isPinned(cam)) state.pins = state.pins.filter(p => p !== k);
    else if (state.pins.length >= PIN_LIMIT) return toast(`The wall holds ${PIN_LIMIT} cameras. Unpin one first.`);
    else { state.pins.push(k); toast(`Pinned · ${state.pins.length} on wall`); }
    store.set('pins', state.pins); renderPinButton(); updateWallCount();
  }
  const updateWallCount = () => ($('wallCount').textContent = state.pins.filter(k => state.byKey.has(k)).length);

  let wallPlayers = [];
  function openWall() {
    stopTour();
    const cams = state.pins.map(k => state.byKey.get(k)).filter(Boolean);
    wallPlayers.forEach(m => m.destroy());
    wallPlayers = [];
    $('wallHint').textContent = cams.length ? `${cams.length} of ${PIN_LIMIT} slots in use.` : 'Nothing pinned yet. Open a camera on the globe and press “Pin to wall”.';
    $('wallGrid').replaceChildren(...cams.map(cam => {
      const m = playerFor(cam, { compact: true }); wallPlayers.push(m);
      const tile = el('article', { class: 'tile' },
        el('header', {},
          el('span', { class: 'dot', style: `color:${CATS[cam.c].color}` }),
          el('button', { class: 't', title: `${cam.t}: show on globe`, onclick: () => { closeWall(); select(cam.i); } }, cam.t),
          el('button', { class: 'icon-btn', 'aria-label': `Unpin ${cam.t}`, onclick: () => { togglePin(cam); m.destroy(); tile.remove(); $('wallHint').textContent = `${state.pins.length} of ${PIN_LIMIT} slots in use.`; } },
            el('span', { 'aria-hidden': 'true' }, '×'))),
        m.node);
      return tile;
    }));
    $('wall').hidden = false;
    if (viewerPlayer) { viewerPlayer.destroy(); viewerPlayer = null; } // don't play the same feed twice
  }
  function closeWall() {
    wallPlayers.forEach(m => m.destroy()); wallPlayers = [];
    $('wall').hidden = true;
    if (state.selected >= 0) showPlayer(state.cams[state.selected]);
  }

  // ---------- teleport & tour ----------
  function randomCam() {
    const pool = (state.visible.length ? state.visible : state.cams).filter(c => !state.offline.has(c.i));
    if (!pool.length) return null;
    // Half the time pick a YouTube/Windy stream (scenery), otherwise pick a region first so the
    // states with thousands of traffic cams don't drown everything else out.
    const scenic = pool.filter(c => c.k !== 'hls');
    if (scenic.length && Math.random() < 0.5) return scenic[Math.floor(Math.random() * scenic.length)];
    const bySrc = {};
    for (const c of pool) (bySrc[c.s] ||= []).push(c);
    const srcs = Object.keys(bySrc);
    const list = bySrc[srcs[Math.floor(Math.random() * srcs.length)]];
    return list[Math.floor(Math.random() * list.length)];
  }
  function teleport() {
    const cam = randomCam();
    if (!cam) return;
    map.flyTo({ center: [cam.lo, cam.la], zoom: 2.2, duration: 900 });
    setTimeout(() => select(cam.i), 950);
  }
  function tourStep() {
    if (!state.tour) return;
    const cam = randomCam();
    if (!cam) return stopTour();
    map.flyTo({ center: [cam.lo, cam.la], zoom: 3, duration: 2600, essential: true });
    setTimeout(() => state.tour && select(cam.i, { fromTour: true }), 2700);
    state.tourTimer = setTimeout(tourStep, TOUR_DWELL_MS);
  }
  function startTour() {
    state.tour = true; $('btnTour').setAttribute('aria-pressed', 'true');
    toast('Auto-tour on · drag the globe to stop');
    tourStep();
  }
  function stopTour() {
    if (!state.tour) return;
    state.tour = false; clearTimeout(state.tourTimer); $('btnTour').setAttribute('aria-pressed', 'false');
  }

  // ---------- search ----------
  let resultIdx = -1;
  function runSearch(q) {
    const ul = $('results');
    q = q.trim().toLowerCase();
    if (q.length < 2) { ul.hidden = true; return; }
    const terms = q.split(/\s+/);
    const hits = [];
    for (const c of state.cams) if (terms.every(t => c.search.includes(t))) { hits.push(c); if (hits.length >= 80) break; }
    hits.sort((a, b) => ((a.k === 'hls') - (b.k === 'hls')) || (passes(b) - passes(a)));
    resultIdx = -1;
    ul.replaceChildren(...(hits.length ? hits.slice(0, 40).map(c => el('li', { role: 'option', onclick: () => pick(c) },
      el('span', { class: 'dot', style: `color:${CATS[c.c].color}` }),
      el('span', { class: 'r-t' }, c.t),
      el('span', { class: 'r-s' }, `${c.r || ''} · ${state.sources[c.s]?.name || c.s}`))) : [el('li', { class: 'empty' }, 'No live cameras match that search.')]));
    ul.hidden = false;
    function pick(c) { ul.hidden = true; $('q').blur(); select(c.i); }
  }

  // ---------- interactions ----------
  let hoverId = null;
  function featureAt(point, pad = 7) {
    const feats = map.queryRenderedFeatures([[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]], { layers: ['cams-dot'] });
    if (!feats.length) return null;
    let best = feats[0], bd = Infinity;
    for (const f of feats) {
      const p = map.project(f.geometry.coordinates); const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  function setHover(id) {
    if (hoverId === id) return;
    if (hoverId != null) map.setFeatureState({ source: 'cams', id: hoverId }, { hover: false });
    hoverId = id;
    if (id != null) map.setFeatureState({ source: 'cams', id }, { hover: true });
  }

  function wireUi() {
    map.on('mousemove', e => {
      const f = featureAt(e.point);
      const tip = $('tip');
      if (!f) { setHover(null); tip.hidden = true; map.getCanvas().style.cursor = ''; return; }
      const c = state.cams[f.id];
      setHover(f.id);
      map.getCanvas().style.cursor = 'pointer';
      tip.replaceChildren(c.t, el('span', { class: 's' }, `${c.r || ''} · ${FEED_LABEL[c.k]}`));
      tip.style.left = Math.min(e.originalEvent.clientX + 14, innerWidth - 290) + 'px';
      tip.style.top = (e.originalEvent.clientY + 14) + 'px';
      tip.hidden = false;
    });
    map.on('mouseout', () => { setHover(null); $('tip').hidden = true; });
    map.on('click', e => { const f = featureAt(e.point, 10); if (f) select(f.id, { fly: map.getZoom() < 9 }); });
    for (const ev of ['dragstart', 'wheel', 'touchstart']) map.on(ev, e => { if (e.originalEvent) stopTour(); });

    $('vClose').onclick = closeViewer;
    $('vPin').onclick = () => togglePin(state.cams[state.selected]);
    $('vNext').onclick = () => { const n = nearby(state.cams[state.selected], 1)[0]; if (n) select(n[0].i); };
    $('vShare').onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); toast('Link copied'); }
      catch { toast('Copy failed. Use the address bar instead.'); }
    };
    $('btnTeleport').onclick = teleport;
    $('btnTour').onclick = () => (state.tour ? stopTour() : startTour());
    $('btnWall').onclick = openWall;
    $('wallClose').onclick = closeWall;
    $('wallClear').onclick = () => { state.pins = []; store.set('pins', []); updateWallCount(); renderPinButton(); openWall(); };
    $('hudToggle').onclick = () => {
      const c = $('hud').classList.toggle('collapsed');
      $('hudToggle').setAttribute('aria-expanded', String(!c));
    };

    let deb;
    $('q').addEventListener('input', e => { clearTimeout(deb); deb = setTimeout(() => runSearch(e.target.value), 120); });
    $('q').addEventListener('keydown', e => {
      const items = [...$('results').querySelectorAll('li[role=option]')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!items.length) return;
        resultIdx = (resultIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((li, n) => li.setAttribute('aria-selected', String(n === resultIdx)));
        items[resultIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') { items[Math.max(0, resultIdx)]?.click(); }
      else if (e.key === 'Escape') { $('results').hidden = true; }
    });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) $('results').hidden = true; });

    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea')) return;
      if (e.key === 'Escape') { if (!$('wall').hidden) closeWall(); else closeViewer(); }
      else if (e.key === 'r' || e.key === 'R') teleport();
      else if (e.key === 't' || e.key === 'T') state.tour ? stopTour() : startTour();
      else if (e.key === 'w' || e.key === 'W') $('wall').hidden ? openWall() : closeWall();
      else if (e.key === '/') { e.preventDefault(); $('q').focus(); }
    });

    if (matchMedia('(max-width: 860px)').matches) { $('hud').classList.add('collapsed'); $('hudToggle').setAttribute('aria-expanded', 'false'); }
    setInterval(() => ($('clock').textContent = new Date().toISOString().slice(11, 19)), 1000);
  }

  // ---------- boot ----------
  Promise.all([loadData(), new Promise(r => map.once('load', r))]).then(() => {
    addLayers();
    renderFilters();
    applyFilters();
    wireUi();
    updateWallCount();
    $('statTotal').textContent = state.cams.length.toLocaleString();
    $('statScenic').textContent = state.cams.filter(c => c.k !== 'hls').length.toLocaleString();
    const m = location.hash.match(/^#cam=(.+)$/);
    const linked = m && state.byKey.get(decodeURIComponent(m[1]));
    if (linked) select(linked.i);
    else map.easeTo({ center: [-60, 30], zoom: 1.9, duration: 2500 });
    $('boot').classList.add('done');
    setTimeout(() => $('boot').remove(), 700);
    setTimeout(probeSources, 1500);
  }).catch(err => {
    console.error(err);
    $('boot').querySelector('p').textContent = 'Could not load the camera list. Run the local server (npm start) instead of opening the file directly.';
  });
})();
