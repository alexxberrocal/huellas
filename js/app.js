/* Huellas · controlador de la aplicación: importación, estado, mapa, barra de tiempo y diálogos. */
(function () {
  'use strict';
  const H = window.H, $ = H.$, $$ = H.$$;
  const MIN = 60000;

  const VIEWS = [
    { key: 'routes', name: 'Rutas', icon: 'route' },
    { key: 'heat', name: 'Calor', icon: 'flame' },
    { key: 'hex', name: '3D', icon: 'hexagon' },
    { key: 'anim', name: 'Animación', icon: 'play' },
    { key: 'trips', name: 'Viajes', icon: 'plane-takeoff' },
    { key: 'countries', name: 'Países', icon: 'earth' },
  ];
  const SPEEDS = [
    { min: 30, label: '30 min/s' }, { min: 120, label: '2 h/s' }, { min: 360, label: '6 h/s' }, { min: 1440, label: '1 día/s' },
    { min: 4320, label: '3 días/s' }, { min: 10080, label: '1 sem/s' }, { min: 43200, label: '1 mes/s' },
  ];

  const app = (H.app = {
    D: null,
    S: {
      mode: 'routes', f: { d0: 0, d1: 0, c: -1 }, tab: 'summary', colorBy: H.storage.get('colorBy', 'mode'), modeMask: 255,
      dayView: null, place: null, pathWidth: H.storage.get('pathWidth', 2), showPlaces: H.storage.get('showPlaces', true),
      heatRadius: H.storage.get('heatRadius', 28), hexRadius: 400, zoom: 2,
      anim: { t: 0, playing: false, speed: 3, trail: 1440, follow: false, head: null },
    },
    more: { places: 60, cities: 40 },
    calYear: 0,
    isDemo: false,
  });
  const app$ = document.getElementById('app');

  // ================================================================ utilidades de interfaz
  function hydrateIcons(root) { $$('[data-icon]', root).forEach((e) => { if (!e.firstElementChild) e.insertAdjacentHTML('afterbegin', H.icon(e.dataset.icon)); }); }
  H.toast = function (msg, opts) {
    opts = opts || {};
    const t = H.el('div', { class: 'toast' + (opts.type === 'warn' ? ' warn' : '') }, H.icon(opts.icon || (opts.type === 'warn' ? 'triangle-alert' : 'check')) + '<span></span>');
    t.querySelector('span').textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, opts.ms || 3800);
  };
  function screen(name) { app$.dataset.screen = name; }
  const effF = () => (app.S.dayView != null ? { d0: app.S.dayView, d1: app.S.dayView, c: -1 } : app.S.f);
  app.effF = effF;

  // ================================================================ arranque
  function init() {
    hydrateIcons(document);
    $('.drop-icon').innerHTML = H.icon('upload');
    $('#demo').innerHTML = H.icon('sparkles') + 'Probar con datos de demostración';
    if (!window.maplibregl || !window.deck) {
      $('#err-msg').textContent = 'No se han podido cargar los componentes del mapa (carpeta vendor). Vuelve a descargar el proyecto completo.';
      screen('error');
      return;
    }
    app.engine = new H.Engine();
    app.engine.start().catch(() => { /* se reintenta al importar */ });
    app.mapView = new H.MapView('map');
    app.mapView.whenReady(() => { if (app$.dataset.screen !== 'app') app.mapView.startSpin(); });
    app.mapView.onHover = onMapHover;
    app.mapView.onClick = onMapClick;
    app.mapView.onFallback = () => H.toast('Sin conexión con el servidor de mapas: uso un mapa básico sin conexión.', { type: 'warn', icon: 'globe', ms: 6000 });
    app.mapView.map.on('zoomend', onZoomEnd);
    // las etiquetas se reparten según lo que se ve: se recalculan al terminar de mover el mapa
    app.mapView.map.on('moveend', () => {
      const S = app.S;
      if (app.D && app$.dataset.screen === 'app' && !S.anim.playing && (S.mode === 'trips' || S.mode === 'countries' || S.dayView != null || (S.mode === 'routes' && S.zoom >= 10.5))) renderMap();
    });
    app.panels = H.Panels(app);
    app.story = H.Story(app);
    bindIntro();
    bindApp();
    refreshResume();
    if (/[?&#]demo\b/.test(location.search + location.hash)) $('#demo').click();
  }

  async function refreshResume() {
    const info = H.store.info();
    const btn = $('#resume');
    if (app.D) {
      btn.hidden = false;
      btn.innerHTML = H.icon('map') + 'Volver a tu mapa';
      btn.onclick = () => enterApp(false);
      return;
    }
    if (!info) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.innerHTML = H.icon('history') + 'Continuar con tus datos <span class="muted">· ' + H.fmtDay(H.localDay(info.at, -new Date(info.at).getTimezoneOffset())) + '</span>';
    btn.onclick = async () => {
      btn.disabled = true;
      const ds = await H.store.load();
      btn.disabled = false;
      if (!ds) { H.toast('No se encontraron los datos guardados. Vuelve a importar tu archivo.', { type: 'warn' }); H.store.clear(); btn.hidden = true; return; }
      useDataset(ds, { fromStore: true });
    };
  }

  // ================================================================ importar
  const RELEVANT = /\.(json|zip|kml|gpx|csv)$/i;
  async function filesFromDrop(dt) {
    const items = dt.items ? Array.from(dt.items) : [];
    const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.length || !entries.some((e) => e.isDirectory)) return Array.from(dt.files || []);
    const out = [];
    async function walk(entry, depth) {
      if (entry.isFile) {
        const f = await new Promise((res, rej) => entry.file(res, rej));
        if (depth === 0 || RELEVANT.test(f.name)) out.push(f);
      } else if (entry.isDirectory && depth < 8) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e, depth + 1);
        } while (batch.length);
      }
    }
    for (const e of entries) await walk(e, 0);
    return out;
  }

  function bindIntro() {
    const drop = $('#drop'), fi = $('#file-input'), fo = $('#folder-input');
    $('#pick-files').addEventListener('click', (e) => { e.stopPropagation(); fi.click(); });
    $('#pick-folder').addEventListener('click', (e) => { e.stopPropagation(); fo.click(); });
    drop.addEventListener('click', () => fi.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    fi.addEventListener('change', () => { if (fi.files.length) importFiles(Array.from(fi.files)); fi.value = ''; });
    fo.addEventListener('change', () => {
      const files = Array.from(fo.files).filter((f) => RELEVANT.test(f.name));
      fo.value = '';
      if (!files.length) { H.toast('En esa carpeta no hay archivos JSON, ZIP, KML, GPX ni CSV.', { type: 'warn' }); return; }
      importFiles(files);
    });
    let depth = 0;
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; drop.classList.add('over'); });
    window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('over'); });
    window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      drop.classList.remove('over');
      if (app$.dataset.screen === 'loading') return;
      const files = await filesFromDrop(e.dataTransfer);
      if (!files.length) { H.toast('No he encontrado archivos que leer.', { type: 'warn' }); return; }
      importFiles(files);
    });
    $('#demo').addEventListener('click', () => {
      screen('loading');
      setProgress({ stage: 'read', pct: 0, msg: 'Generando dos años de datos de ejemplo…' });
      setTimeout(() => importFiles([H.makeDemoFile()], { demo: true }), 30);
    });
    $('#cancel-load').addEventListener('click', () => { app.importSeq++; app.engine.reset(); screen(app.D ? 'app' : 'intro'); refreshResume(); if (!app.D) app.mapView.startSpin(); });
    $('#err-back').addEventListener('click', () => { screen(app.D ? 'app' : 'intro'); refreshResume(); });
    $$('[data-howto]').forEach((b) => b.addEventListener('click', () => {
      $$('[data-howto]').forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
      $$('[data-howto-body]').forEach((x) => { x.hidden = x.dataset.howtoBody !== b.dataset.howto; });
    }));
    if (/iPhone|iPad/.test(navigator.userAgent)) $('[data-howto="ios"]').click();
  }
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  app.importSeq = 0;
  app.importFiles = (files, opts) => importFiles(Array.from(files), opts);
  async function importFiles(files, opts) {
    opts = opts || {};
    const seq = ++app.importSeq;
    stopPlay();
    if (app.story.isOpen()) app.story.close();
    screen('loading');
    setProgress({ stage: 'read', pct: 0, msg: files.length === 1 ? files[0].name : files.length + ' archivos' });
    const t0 = performance.now();
    try {
      const ds = await app.engine.run(files, (p) => { if (seq === app.importSeq) setProgress(p); });
      if (seq !== app.importSeq) return;
      setProgress({ stage: 'analyze', pct: 1, msg: 'Dibujando…' });
      await new Promise((r) => setTimeout(r, 60));
      useDataset(ds, { demo: !!opts.demo, ms: performance.now() - t0 });
    } catch (err) {
      if (seq !== app.importSeq) return;
      console.error(err);
      $('#err-msg').textContent = err.message || String(err);
      screen('error');
    }
  }

  function setProgress(p) {
    const total = p.stage === 'read' ? p.pct * 0.72 : 0.72 + p.pct * 0.28;
    $('#ring').style.strokeDashoffset = String(326.7 * (1 - total));
    $('#load-pct').textContent = Math.round(total * 100) + '%';
    $('#load-title').textContent = p.stage === 'read' ? 'Leyendo tus datos…' : 'Analizando tu historia…';
    $('#load-msg').textContent = p.msg || '';
    const step = p.stage === 'read' ? 0 : p.pct < 0.2 ? 1 : p.pct < 0.48 ? 2 : p.pct < 0.9 ? 3 : 4;
    $$('#load-steps li').forEach((li, i) => { li.className = i < step ? 'done' : i === step ? 'on' : ''; });
  }

  function useDataset(ds, opts) {
    opts = opts || {};
    try {
      app.D = new H.Data(ds);
    } catch (err) {
      console.error(err);
      $('#err-msg').textContent = 'Error preparando los datos: ' + err.message;
      screen('error');
      return;
    }
    app.isDemo = !!opts.demo;
    const S = app.S;
    S.f = { d0: 0, d1: app.D.nDays - 1, c: -1 };
    S.dayView = null; S.place = null; S.modeMask = 255; S.tab = 'summary';
    app.more = { places: 60, cities: 40 };
    app.calYear = app.D.years[app.D.years.length - 1] || 0;
    const fullSpan = (app.D.dayMs(app.D.nDays) - app.D.dayMs(0)) / MIN;
    S.anim.speed = pickSpeed(fullSpan);
    S.anim.t = (app.D.dayMs(0) - app.D.T0) / MIN;
    enterApp(true);
    const m = ds.meta;
    if (!opts.fromStore && !opts.demo) {
      H.store.save(ds).then((ok) => { if (ok) H.toast('Guardado en este navegador: la próxima vez entrarás directo.', { icon: 'database', ms: 4200 }); });
    }
    const failed = m.files.filter((f) => f.error);
    const empty = m.files.filter((f) => !f.error && !f.items && !f.skipped);
    setTimeout(() => {
      H.toast((opts.demo ? 'Demostración cargada: ' : 'Listo: ') + H.n0(m.rawPoints) + ' puntos de ' + H.plural(app.D.stats(S.f).days, 'día', 'días') + '.', { icon: 'check', ms: 4500 });
      if (failed.length) H.toast(failed.length + ' archivo(s) no se pudieron leer: ' + failed.map((f) => f.name).join(', '), { type: 'warn', ms: 8000 });
      if (empty.length) H.toast('Sin ubicaciones en: ' + empty.map((f) => f.name).join(', '), { type: 'warn', ms: 7000 });
      if (!H.storage.get('hintTimeline', false)) { H.storage.set('hintTimeline', true); setTimeout(() => H.toast('Truco: arrastra sobre la barra de abajo para elegir fechas. Clic en un día para ver su itinerario.', { icon: 'info', ms: 7000 }), 1800); }
    }, 900);
  }

  function enterApp(fit) {
    screen('app');
    app.mapView.stopSpin();
    app.mapView.forceGlobe = false;
    app.mapView.applyProjection();
    buildChrome();
    renderAll();
    if (fit) setTimeout(() => app.mapView.fit(app.D.bboxOf(app.S.f), { duration: 2200 }), 80);
  }

  // ================================================================ estructura del panel
  function buildChrome() {
    $('#modes').innerHTML = VIEWS.map((v, i) => '<button class="mode-btn" data-view="' + v.key + '" title="' + v.name + ' (' + (i + 1) + ')" aria-pressed="false">' + H.icon(v.icon) + '<span>' + v.name + '</span></button>').join('');
    $$('#modes [data-view]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.view)));
    $('#tabs').innerHTML = H.TABS.map((t) => '<button class="tab" role="tab" data-tab="' + t.key + '" aria-selected="false">' + H.icon(t.icon) + t.name + '</button>').join('');
    $$('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    if (!$('.panel-open')) {
      const open = H.el('button', { class: 'icon-btn glass panel-open', title: 'Mostrar estadísticas', type: 'button' }, H.icon('panel-left'));
      open.addEventListener('click', () => setPanel(true));
      app$.appendChild(open);
    }
    renderPresets();
    setMode(app.S.mode, true);
  }

  function setPanel(open) {
    app$.dataset.panel = open ? 'open' : 'closed';
    H.storage.set('panel', open);
    setTimeout(drawTimeline, 420);
  }
  function setTab(key) {
    app.S.tab = key;
    $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === key ? 'true' : 'false'));
    if (app$.dataset.panel === 'closed' && window.innerWidth <= 760) setPanel(true);
    renderPanel(true);
  }
  app.setTab = setTab;

  function setMode(key, quiet) {
    const S = app.S, prev = S.mode;
    S.mode = key;
    app$.dataset.mode = key;
    $$('#modes [data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === key ? 'true' : 'false'));
    const map = app.mapView.map;
    // las vistas 3D (columnas y arcos) se inclinan solas; al salir, el mapa vuelve a plano
    const TILT = { hex: 52, trips: 38 };
    if (key === 'hex' && prev !== 'hex') { S.hexRadius = hexRadiusFor(map.getZoom(), map.getCenter().lat); S.hexLat = map.getCenter().lat; }
    if (TILT[key] && !TILT[prev] && !app.mapView.globe) map.easeTo({ pitch: Math.max(map.getPitch(), TILT[key]), duration: 1100 });
    else if (TILT[prev] && !TILT[key] && map.getPitch() > 5) map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
    if (key !== 'anim') { stopPlay(); $('#anim-hud').hidden = true; }
    else { clampAnim(); updateHead(); $('#anim-hud').hidden = false; updateHud(); }
    $('#speed').textContent = SPEEDS[S.anim.speed].label;
    if (!quiet || true) { renderLegend(); renderMap(); drawTimeline(); }
  }
  app.setMode = setMode;

  // ================================================================ render
  function renderAll() {
    renderScope();
    renderCountryBtn();
    renderPanel(false);
    renderDetail();
    renderLegend();
    renderMap();
    drawTimeline();
  }
  app.renderAll = renderAll;

  function renderScope() {
    const D = app.D, f = app.S.f;
    const full = f.d0 === 0 && f.d1 === D.nDays - 1;
    $('#scope').innerHTML = H.icon('calendar') + '<b>' + (full ? 'Todo tu historial' : H.fmtRange(D.absDay(f.d0), D.absDay(f.d1))) + '</b>' + (full ? '<span>· ' + H.fmtRange(D.absDay(0), D.absDay(D.nDays - 1)) + '</span>' : '') +
      (f.c >= 0 ? '<span>·</span><span class="flag">' + H.flag(H.countryIso(f.c)) + '</span><b>' + H.esc(H.countryName(f.c)) + '</b>' : '') +
      (app.isDemo ? '<span class="badge" style="margin-left:auto">demo</span>' : '');
    const n = f.d1 - f.d0 + 1;
    $('#tl-range').innerHTML = H.icon('calendar') + (full ? 'Todo' : H.fmtRange(D.absDay(f.d0), D.absDay(f.d1))) + ' <small>' + H.plural(n, 'día', 'días') + '</small>';
    $$('#tl-presets [data-preset]').forEach((b) => b.classList.toggle('on', presetMatches(b.dataset.preset)));
  }

  const renderPanelSoon = H.debounce(() => renderPanel(false), 160);
  function renderPanel(animate) {
    const body = $('#panel-body');
    const tab = app.S.tab;
    $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'));
    const keep = !animate ? body.scrollTop : 0;
    try { app.panels[tab](body); } catch (err) { console.error(err); body.innerHTML = '<div class="empty">No se pudo dibujar esta sección: ' + H.esc(err.message) + '</div>'; }
    body.scrollTop = keep;
    if (animate) { body.classList.remove('fade'); void body.offsetWidth; body.classList.add('fade'); }
  }
  app.renderPanel = renderPanel;

  function renderDetail() {
    const S = app.S, el = $('#detail-body');
    if (S.dayView != null) { app.panels.day(el, S.dayView); $('#detail').hidden = false; app$.dataset.detail = 'open'; }
    else if (S.place != null) { app.panels.place(el, S.place); $('#detail').hidden = false; app$.dataset.detail = 'open'; }
    else { $('#detail').hidden = true; delete app$.dataset.detail; }
  }

  let storyOverride = null;
  function renderMap() {
    if (!app.D) return;
    let S = app.S;
    S.globe = app.mapView.globe;
    if (storyOverride) S = Object.assign({}, S, { mode: storyOverride.mode, f: storyOverride.f, dayView: null, anim: storyOverride.anim || S.anim });
    try {
      app.mapView.setLayers(H.buildLayers(S, app.D));
    } catch (err) {
      console.error(err);
      H.toast('No se pudo dibujar esta vista: ' + err.message, { type: 'warn' });
    }
  }
  const renderMapSoon = H.rafThrottle(renderMap);
  app.renderMap = renderMap;

  function renderLegend() {
    const S = app.S, el = $('#legend');
    let html = '';
    if (S.mode === 'routes' || S.mode === 'anim') {
      if (S.colorBy === 'year' && S.mode === 'routes') {
        const ys = app.D.years;
        html = '<div class="legend-title"><span>Rutas por año</span>' + colorSeg() + '</div><div class="legend-items">' + ys.map((y) => '<span class="lg-item"><i class="swatch" style="background:rgb(' + H.yearColor(y, ys[0], ys[ys.length - 1]).join(',') + ')"></i>' + y + '</span>').join('') + '</div>';
      } else {
        const st = app.D.stats(effF());
        const present = H.MODES.map((m, i) => i).filter((i) => st.km[i] > 0);
        html = '<div class="legend-title"><span>' + (S.mode === 'anim' ? 'Recorridos animados' : 'Medio de transporte') + (app.D.ds.meta.inferredModes ? ' · estimado' : '') + '</span>' + (S.mode === 'routes' ? colorSeg() : '') + '</div><div class="legend-items">' +
          (present.length ? present.map((i) => '<button class="lg-item' + (S.modeMask & (1 << i) ? '' : ' off') + '" data-mode="' + i + '" title="Mostrar u ocultar"><i class="swatch" style="background:' + H.MODES[i].color + '"></i>' + H.MODES[i].short + '</button>').join('') : '<span class="muted">Sin desplazamientos en este periodo</span>') + '</div>';
      }
    } else if (S.mode === 'heat' || S.mode === 'hex') {
      html = '<div class="legend-title"><span>' + (S.mode === 'heat' ? 'Dónde pasas el tiempo' : 'Tiempo pasado en 3D') + '</span></div><div class="lg-ramp" style="background:linear-gradient(90deg,' + H.RAMP_HEAT.slice(2).join(',') + ')"></div><div class="lg-ramp-l"><span>Poco</span><span>Mucho tiempo</span></div>';
    } else if (S.mode === 'trips') {
      html = '<div class="legend-title"><span>Viajes desde casa · grosor = días</span></div><div class="legend-items">' + H.MODES.slice(0, 7).map((m) => '<span class="lg-item"><i class="swatch" style="background:' + m.color + '"></i>' + m.short + '</span>').join('') + '</div>';
    } else if (S.mode === 'countries') {
      const st = app.D.stats(S.f);
      const max = st.countries.length ? st.countries[0].days : 1;
      html = '<div class="legend-title"><span>Días en cada país</span></div><div class="lg-ramp" style="background:linear-gradient(90deg,' + H.RAMP_BLUE.slice(2).join(',') + ')"></div><div class="lg-ramp-l"><span>1 día</span><span>' + H.plural(max, 'día', 'días') + '</span></div>';
    }
    el.innerHTML = html;
    el.hidden = !html;
    $$('[data-mode]', el).forEach((b) => b.addEventListener('click', () => toggleMode(+b.dataset.mode)));
    $$('[data-color]', el).forEach((b) => b.addEventListener('click', () => { S.colorBy = b.dataset.color; H.storage.set('colorBy', S.colorBy); renderLegend(); renderMap(); }));
  }
  const colorSeg = () => '<span class="seg"><button data-color="mode" aria-pressed="' + (app.S.colorBy === 'mode') + '">Medio</button><button data-color="year" aria-pressed="' + (app.S.colorBy === 'year') + '">Año</button></span>';

  function toggleMode(m) {
    const S = app.S;
    const bit = 1 << m;
    const st = app.D.stats(effF());
    const present = H.MODES.map((x, i) => i).filter((i) => st.km[i] > 0);
    // primer clic: mostrar solo ese medio; si ya era el único, volver a todos
    const onlyThis = present.every((i) => (i === m ? S.modeMask & bit : !(S.modeMask & (1 << i))));
    if (S.modeMask === 255) S.modeMask = bit;
    else if (onlyThis) S.modeMask = 255;
    else S.modeMask ^= bit;
    if (!(S.modeMask & 255)) S.modeMask = 255;
    renderLegend(); renderMap();
    if (S.tab === 'summary') renderPanel(false);
  }
  app.toggleMode = toggleMode;

  // ================================================================ filtros
  function setRange(d0, d1, fit, opts) {
    const D = app.D, S = app.S;
    d0 = Math.max(0, Math.min(D.nDays - 1, Math.round(d0)));
    d1 = Math.max(d0, Math.min(D.nDays - 1, Math.round(d1)));
    if (S.f.d0 === d0 && S.f.d1 === d1 && !fit) return;
    S.f = { d0, d1, c: S.f.c };
    if (S.dayView != null && !(opts && opts.keepDay)) { S.dayView = null; renderDetail(); }
    clampAnim();
    renderScope();
    if (opts && opts.live) { renderMapSoon(); drawTimeline(); renderPanelSoon(); renderLegendSoon(); return; }
    renderPanel(false); renderLegend(); renderMap(); drawTimeline();
    if (fit) app.mapView.fit(D.bboxOf(S.f));
  }
  const renderLegendSoon = H.debounce(() => renderLegend(), 160);
  app.setRange = setRange;

  function setCountry(c, fit) {
    const S = app.S;
    S.f = { d0: S.f.d0, d1: S.f.d1, c };
    if (S.dayView != null) { S.dayView = null; renderDetail(); }
    renderAll();
    if (fit) {
      if (c >= 0) app.mapView.fit(app.D.bboxOf(S.f) || H.COUNTRIES[c].bbox, { maxZoom: 12 });
      else app.mapView.fit(app.D.bboxOf(S.f));
    }
  }
  app.setCountry = setCountry;

  function renderCountryBtn() {
    const c = app.S.f.c;
    $('#country-btn').innerHTML = c >= 0 ? '<span class="flag">' + H.flag(H.countryIso(c)) + '</span><span class="lbl">' + H.esc(H.countryName(c)) + '</span><span class="x" data-clear title="Quitar filtro">' + H.icon('x') + '</span>' : H.icon('earth') + '<span class="lbl">Todos los países</span>' + H.icon('chevron-down');
    $('#country-btn').setAttribute('aria-pressed', c >= 0 ? 'true' : 'false');
  }
  function openCountryPicker() {
    const pop = $('#country-pop');
    if (!pop.hidden) { pop.hidden = true; return; }
    const st = app.D.stats({ d0: 0, d1: app.D.nDays - 1, c: -1 });
    const all = [{ c: -1, days: st.days }].concat(st.countries);
    let kb = 0;
    const draw = () => {
      const q = $('#country-search').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const list = all.filter((x) => x.c < 0 ? !q : H.countryName(x.c).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
      kb = Math.min(kb, Math.max(0, list.length - 1));
      $('#country-list').innerHTML = list.length ? list.map((x, i) => '<button class="picker-item' + (x.c === app.S.f.c ? ' sel' : '') + (i === kb ? ' kb' : '') + '" data-c="' + x.c + '" role="option">' + (x.c < 0 ? '<span class="flag">' + H.icon('earth') + '</span><span class="nm">Todos los países</span>' : '<span class="flag">' + H.flag(H.countryIso(x.c)) + '</span><span class="nm">' + H.esc(H.countryName(x.c)) + '</span>') + '<span class="ct">' + H.plural(x.days, 'día', 'días') + '</span></button>').join('') : '<div class="empty">Ningún país coincide</div>';
      $$('#country-list [data-c]').forEach((b) => b.addEventListener('click', () => { pop.hidden = true; setCountry(+b.dataset.c, true); }));
      return list;
    };
    pop.hidden = false;
    const input = $('#country-search');
    input.value = '';
    draw();
    input.oninput = () => { kb = 0; draw(); };
    input.onkeydown = (e) => {
      const items = $$('#country-list [data-c]');
      if (e.key === 'ArrowDown') { kb = Math.min(items.length - 1, kb + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { kb = Math.max(0, kb - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[kb]) items[kb].click();
      else if (e.key === 'Escape') { pop.hidden = true; e.stopPropagation(); }
    };
    setTimeout(() => input.focus(), 20);
  }

  // ================================================================ detalle
  function openDay(d) {
    const S = app.S;
    if (d < 0 || d >= app.D.nDays) return;
    S.dayView = d; S.place = null;
    if (S.mode !== 'routes' && S.mode !== 'anim') setMode('routes', true);
    renderDetail(); renderMap(); drawTimeline(); renderLegend();
    if (S.tab === 'patterns') renderPanel(false);
    const info = app.D.day(d);
    if (info.bbox) app.mapView.fit(info.bbox, { maxZoom: 15.5, duration: 1200 });
  }
  app.openDay = openDay;
  function openPlace(pi) {
    const S = app.S, p = app.D.ds.places[pi];
    if (!p) return;
    S.place = pi; S.dayView = null;
    renderDetail(); renderMap(); drawTimeline();
    app.mapView.flyTo(p.lo, p.la, Math.max(14.5, app.mapView.map.getZoom()));
  }
  app.openPlace = openPlace;
  function closeDetail() {
    const S = app.S;
    const hadDay = S.dayView != null;
    S.dayView = null; S.place = null;
    renderDetail();
    if (hadDay) { renderMap(); drawTimeline(); renderLegend(); }
  }
  app.closeDetail = closeDetail;
  function openTrip(t) {
    if (app.S.mode === 'trips' || app.S.mode === 'countries') setMode('routes', true);
    app.S.dayView = null; app.S.place = null; renderDetail();
    setRange(Math.max(0, t.d0), Math.min(app.D.nDays - 1, t.d1), true);
  }
  app.openTrip = openTrip;
  function playDay(d) {
    const S = app.S;
    S.anim.speed = 1;
    setMode('anim', true);
    S.anim.t = (app.D.dayMs(d) - app.D.T0) / MIN;
    play();
  }
  app.playDay = playDay;

  // ================================================================ animación
  function animRange() {
    const D = app.D, f = effF();
    return [(D.dayMs(f.d0) - D.T0) / MIN, (D.dayMs(f.d1 + 1) - D.T0) / MIN];
  }
  function pickSpeed(spanMin) {
    const want = spanMin / 45;
    for (let i = 0; i < SPEEDS.length; i++) if (SPEEDS[i].min >= want) return i;
    return SPEEDS.length - 1;
  }
  function clampAnim() {
    const a = app.S.anim, [t0, t1] = animRange();
    if (!(a.t >= t0 && a.t <= t1)) a.t = t0;
    a.trail = Math.max(25, Math.min(60 * 24 * 21, SPEEDS[a.speed].min * 1.6));
  }
  function updateHead() {
    const a = app.S.anim, p = app.D.positionAt(app.D.T0 + a.t * MIN);
    a.head = p ? [p.lo, p.la] : null;
    a.headIdx = p ? p.i : -1;
  }
  function updateHud() {
    const D = app.D, a = app.S.anim;
    const ms = D.T0 + a.t * MIN;
    const i = a.headIdx >= 0 ? a.headIdx : 0;
    const off = D.N ? D.ds.pts.off[i] : 0;
    $('#hud-date').textContent = H.fmtDay(H.localDay(ms, off), { weekday: true });
    $('#hud-time').textContent = H.fmtClock(ms, off) + ' · ' + H.fmtTz(off);
    $('#hud-where').textContent = D.N ? D.where(D.ds.pts.ci[i], D.ds.pts.c[i]) : '';
  }
  let raf = 0, lastFrame = 0;
  function play() {
    const S = app.S, a = S.anim;
    if (!app.D) return;
    if (S.mode !== 'anim') setMode('anim', true);
    const [t0, t1] = animRange();
    if (a.t >= t1 - 1) a.t = t0;
    a.playing = true;
    $('#play').innerHTML = H.icon('pause');
    $('#play').title = 'Pausa (espacio)';
    lastFrame = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    const S = app.S, a = S.anim;
    if (!a.playing) return;
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    const [, t1] = animRange();
    a.t += SPEEDS[a.speed].min * (dt / 1000);
    if (a.t >= t1) { a.t = t1; stopPlay(); }
    updateHead();
    renderMap();
    if (a.follow && a.head) {
      const m = app.mapView.map, c = m.getCenter();
      m.jumpTo({ center: [c.lng + (a.head[0] - c.lng) * 0.12, c.lat + (a.head[1] - c.lat) * 0.12] });
    }
    hudSoon();
    drawPlayhead();
    if (a.playing) raf = requestAnimationFrame(frame);
  }
  let hudT = 0;
  function hudSoon() { const now = performance.now(); if (now - hudT > 120) { hudT = now; updateHud(); } }
  function stopPlay() {
    const a = app.S.anim;
    a.playing = false;
    cancelAnimationFrame(raf);
    const b = $('#play');
    if (b) { b.innerHTML = H.icon('play'); b.title = 'Reproducir (espacio)'; }
  }
  function togglePlay() { if (app.S.anim.playing) stopPlay(); else play(); }

  // vista temporal para el resumen animado
  let storyRaf = 0;
  app.storyView = function (mode, f) {
    cancelAnimationFrame(storyRaf);
    if (!mode) { storyOverride = null; renderMap(); return; }
    storyOverride = { mode, f };
    if (mode === 'anim') {
      const D = app.D;
      const t0 = (D.dayMs(f.d0) - D.T0) / MIN, t1 = (D.dayMs(f.d1 + 1) - D.T0) / MIN;
      const anim = { t: t0, trail: (t1 - t0) / 6, head: null };
      storyOverride.anim = anim;
      const start = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - start) / 6500);
        anim.t = t0 + (t1 - t0) * (1 - Math.pow(1 - k, 2));
        renderMap();
        if (k < 1 && storyOverride && storyOverride.anim === anim) storyRaf = requestAnimationFrame(step);
      };
      storyRaf = requestAnimationFrame(step);
    }
    renderMap();
  };

  // ================================================================ barra de tiempo
  const tl = { canvas: null, ctx: null, w: 0, h: 0, drag: null, hover: -1, cols: null };
  function presetList() {
    const D = app.D, out = [{ key: 'all', label: 'Todo' }];
    const ys = D.years;
    for (const y of ys.slice(-7)) out.push({ key: 'y' + y, label: String(y) });
    if (D.nDays > 400) out.push({ key: 'last365', label: 'Últimos 12 meses' });
    if (D.nDays > 60) out.push({ key: 'last30', label: '30 días' });
    return out;
  }
  function presetRange(key) {
    const D = app.D;
    if (key === 'all') return [0, D.nDays - 1];
    if (key === 'last365') return [D.nDays - 365, D.nDays - 1];
    if (key === 'last30') return [D.nDays - 30, D.nDays - 1];
    const y = +key.slice(1);
    return [D.dayOfYear(y), D.dayOfYear(y + 1) - 1];
  }
  function presetMatches(key) {
    const [a, b] = presetRange(key), f = app.S.f, D = app.D;
    return Math.max(0, a) === f.d0 && Math.min(D.nDays - 1, b) === f.d1;
  }
  function renderPresets() {
    $('#tl-presets').innerHTML = presetList().map((p) => '<button class="chip chip-sm" data-preset="' + p.key + '">' + p.label + '</button>').join('');
    $$('#tl-presets [data-preset]').forEach((b) => b.addEventListener('click', () => { const [a, c] = presetRange(b.dataset.preset); setRange(a, c, true); }));
  }

  function sizeTimeline() {
    const c = $('#tl-canvas'), r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    tl.canvas = c; tl.ctx = c.getContext('2d');
    tl.w = Math.max(10, r.width); tl.h = Math.max(10, r.height);
    if (c.width !== Math.round(tl.w * dpr) || c.height !== Math.round(tl.h * dpr)) { c.width = Math.round(tl.w * dpr); c.height = Math.round(tl.h * dpr); }
    tl.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const AX = 14; // franja inferior para las etiquetas de año
  const dayX = (d) => ((d + 0.5) / app.D.nDays) * tl.w;
  const xDay = (x) => Math.max(0, Math.min(app.D.nDays - 1, Math.floor((x / tl.w) * app.D.nDays)));
  function drawTimeline() {
    if (!app.D || app$.dataset.screen !== 'app') return;
    sizeTimeline();
    const D = app.D, S = app.S, ctx = tl.ctx, W = tl.w, Hh = tl.h - AX, n = D.nDays, days = D.ds.days;
    ctx.clearRect(0, 0, W, tl.h);
    // valores por columna de píxel (máximo de los días que caen en ella)
    const cols = Math.max(1, Math.floor(W));
    const km = new Float32Array(cols), has = new Uint8Array(cols), inC = new Uint8Array(cols);
    const kmDay = (d) => { let s = 0; for (let m = 0; m < H.NM; m++) s += days.kmMode[d * H.NM + m]; return s; };
    let countryDays = null;
    if (S.f.c >= 0) {
      countryDays = new Set();
      const DC = D.ds.dayCountry;
      for (let i = 0; i < DC.d.length; i++) if (DC.c[i] === S.f.c) countryDays.add(DC.d[i]);
    }
    for (let d = 0; d < n; d++) {
      const x = Math.min(cols - 1, Math.floor((d / n) * cols));
      if (days.pts[d] > 0) has[x] = 1;
      const v = kmDay(d);
      if (v > km[x]) km[x] = v;
      if (countryDays && countryDays.has(d)) inC[x] = 1;
    }
    let max = 0;
    const sorted = Array.from(km).filter((v) => v > 0).sort((a, b) => a - b);
    max = sorted.length ? sorted[Math.floor(sorted.length * 0.98)] || sorted[sorted.length - 1] : 1;
    const barW = Math.max(1, W / cols);
    const x0 = dayX(S.f.d0) - (W / n) / 2, x1 = dayX(S.f.d1) + (W / n) / 2;
    for (let x = 0; x < cols; x++) {
      if (!has[x]) continue;
      const v = Math.min(1, Math.sqrt(km[x] / max));
      const h = Math.max(2, v * (Hh - 6));
      const px = (x / cols) * W;
      const inside = px + barW > x0 && px < x1;
      ctx.fillStyle = countryDays && !inC[x] ? 'rgba(255,255,255,0.10)' : inside ? '#3987e5' : 'rgba(255,255,255,0.22)';
      ctx.fillRect(px, Hh - h, Math.max(1, barW - (barW > 3 ? 1 : 0)), h);
    }
    // años
    ctx.font = '500 10.5px "Inter Variable", system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    const y0 = new Date(D.absDay(0) * H.DAY).getUTCFullYear(), y1 = new Date(D.absDay(n - 1) * H.DAY).getUTCFullYear();
    for (let y = y0; y <= y1 + 1; y++) {
      const d = D.dayOfYear(y);
      if (d < 0 || d > n) continue;
      const x = (d / n) * W;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(Math.round(x), 0, 1, Hh);
      ctx.fillStyle = '#898781';
      const label = String(y);
      if (x + 30 < W) ctx.fillText(label, x + 4, tl.h - 2);
    }
    if (y1 - y0 < 2 && n < 1100) { // meses cuando hay poco rango
      for (let y = y0; y <= y1; y++) for (let m = 1; m < 12; m++) {
        const d = Math.floor(Date.UTC(y, m, 1) / H.DAY) - D.day0;
        if (d <= 0 || d >= n) continue;
        const x = (d / n) * W;
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(Math.round(x), Hh - 6, 1, 6);
        if (W / (n / 30) > 34) { ctx.fillStyle = '#5f5e5a'; ctx.fillText(H.MES[m], x + 3, tl.h - 2); }
      }
    }
    // selección
    const full = S.f.d0 === 0 && S.f.d1 === n - 1;
    if (!full) {
      ctx.fillStyle = 'rgba(7,8,11,0.55)';
      ctx.fillRect(0, 0, Math.max(0, x0), Hh);
      ctx.fillRect(x1, 0, Math.max(0, W - x1), Hh);
      ctx.fillStyle = 'rgba(57,135,229,0.10)';
      ctx.fillRect(x0, 0, x1 - x0, Hh);
      ctx.fillStyle = '#9ec5f4';
      for (const x of [x0, x1]) { ctx.fillRect(Math.round(x) - 1, 0, 2, Hh); roundRect(ctx, x - 3, Hh / 2 - 9, 6, 18, 3); }
    }
    if (S.dayView != null) {
      const x = dayX(S.dayView);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x) - 1, 0, 2, Hh);
      ctx.beginPath(); ctx.arc(x, 4, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (tl.hover >= 0 && !tl.drag) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(Math.round(dayX(tl.hover)), 0, 1, Hh);
    }
    drawPlayhead(true);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath(); ctx.fill();
  }
  let lastPlayX = -1;
  function drawPlayhead(fresh) {
    const S = app.S;
    if (S.mode !== 'anim' || !app.D || !tl.ctx) return;
    const D = app.D, ms = D.T0 + S.anim.t * MIN;
    const d = (ms - D.dayMs(0)) / H.DAY;
    const x = (d / D.nDays) * tl.w;
    if (!fresh && Math.abs(x - lastPlayX) < 0.5) return;
    if (!fresh) { drawTimeline(); return; }
    lastPlayX = x;
    const ctx = tl.ctx, Hh = tl.h - AX;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(x) - 1, 0, 2, Hh);
    ctx.fillStyle = '#9085e9';
    ctx.beginPath(); ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 6); ctx.closePath(); ctx.fill();
  }

  function bindTimeline() {
    const wrap = $('#tl-wrap');
    const pos = (e) => { const r = wrap.getBoundingClientRect(); return Math.max(0, Math.min(r.width, e.clientX - r.left)); };
    wrap.addEventListener('pointerdown', (e) => {
      if (!app.D || e.button > 0) return;
      wrap.setPointerCapture(e.pointerId);
      const x = pos(e), d = xDay(x), S = app.S, n = app.D.nDays;
      const x0 = dayX(S.f.d0) - (tl.w / n) / 2, x1 = dayX(S.f.d1) + (tl.w / n) / 2;
      const full = S.f.d0 === 0 && S.f.d1 === n - 1;
      let kind = 'new';
      if (!full && Math.abs(x - x0) < 8) kind = 'left';
      else if (!full && Math.abs(x - x1) < 8) kind = 'right';
      else if (!full && x > x0 && x < x1) kind = 'move';
      tl.drag = { kind, startX: x, startD: d, f0: { d0: S.f.d0, d1: S.f.d1 }, moved: false };
      H.tipHide();
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!app.D) return;
      const x = pos(e), d = xDay(x);
      if (!tl.drag) {
        tl.hover = d;
        const D = app.D;
        let km = 0;
        for (let m = 0; m < H.NM; m++) km += D.ds.days.kmMode[d * H.NM + m];
        H.tipShow('<b>' + H.fmtDay(D.absDay(d), { weekday: true }) + '</b><div class="t-s">' + (D.ds.days.pts[d] ? H.km(km) + ' · clic para ver el día' : 'Sin datos') + '</div>', e.clientX, e.clientY - 60);
        drawTimeline();
        const S = app.S, n = D.nDays;
        const x0 = dayX(S.f.d0) - (tl.w / n) / 2, x1 = dayX(S.f.d1) + (tl.w / n) / 2;
        const full = S.f.d0 === 0 && S.f.d1 === n - 1;
        wrap.style.cursor = !full && (Math.abs(x - x0) < 8 || Math.abs(x - x1) < 8) ? 'ew-resize' : !full && x > x0 && x < x1 ? 'grab' : 'crosshair';
        return;
      }
      const g = tl.drag;
      if (Math.abs(x - g.startX) > 3) g.moved = true;
      if (!g.moved) return;
      if (g.kind === 'new') setRange(Math.min(g.startD, d), Math.max(g.startD, d), false, { live: true });
      else if (g.kind === 'left') setRange(Math.min(d, g.f0.d1), g.f0.d1, false, { live: true });
      else if (g.kind === 'right') setRange(g.f0.d0, Math.max(d, g.f0.d0), false, { live: true });
      else {
        const span = g.f0.d1 - g.f0.d0, n = app.D.nDays;
        let a = g.f0.d0 + (d - g.startD);
        a = Math.max(0, Math.min(n - 1 - span, a));
        setRange(a, a + span, false, { live: true });
      }
    });
    const end = (e) => {
      const g = tl.drag;
      tl.drag = null;
      if (!g) return;
      if (!g.moved) {
        const S = app.S;
        if (S.mode === 'anim') { S.anim.t = (app.D.dayMs(g.startD) - app.D.T0) / MIN; clampAnim(); updateHead(); updateHud(); renderMap(); drawTimeline(); }
        else if (app.D.ds.days.pts[g.startD] > 0) openDay(g.startD);
      } else {
        renderPanel(false); renderLegend(); renderMap(); drawTimeline();
      }
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', () => { tl.drag = null; });
    wrap.addEventListener('pointerleave', () => { tl.hover = -1; H.tipHide(); if (!tl.drag) drawTimeline(); });
    wrap.addEventListener('dblclick', () => setRange(0, app.D.nDays - 1, true));
    wrap.addEventListener('wheel', (e) => {
      if (!app.D) return;
      e.preventDefault();
      const S = app.S, n = app.D.nDays, d = xDay(pos(e));
      const span = S.f.d1 - S.f.d0 + 1;
      const k = e.deltaY > 0 ? 1.25 : 0.8;
      const ns = Math.max(1, Math.min(n, Math.round(span * k)));
      const f = (d - S.f.d0) / Math.max(1, span);
      let a = Math.round(d - f * ns);
      a = Math.max(0, Math.min(n - ns, a));
      setRange(a, a + ns - 1, false, { live: true });
      renderPanelSoon();
    }, { passive: false });
  }

  // ================================================================ mapa: tooltip y clics
  function onMapHover(info) {
    if (!app.D || !info || app$.dataset.screen !== 'app') { H.tipHide(); return; }
    const html = tooltipFor(info);
    if (html) H.tipShow(html, info.x + mapOffset().left, info.y + mapOffset().top); else H.tipHide();
  }
  const mapOffset = () => { const r = document.getElementById('map').getBoundingClientRect(); return { left: r.left, top: r.top }; };
  function segAt(info) {
    const S = app.S, f = storyOverride ? storyOverride.f : effF();
    const sv = app.D.segments(f, S.colorBy, S.modeMask);
    return info.index >= 0 && info.index < sv.n ? sv.map(info.index) : -1;
  }
  function tooltipFor(info) {
    const D = app.D, id = info.layer && info.layer.id;
    if (!id || info.index < 0) return '';
    if (id === 'paths') {
      const s = segAt(info);
      if (s < 0) return '';
      const S2 = D.ds.segs, m = H.MODES[S2.mode[s]], d = D.segDay[s];
      const off = D.ds.days.off[Math.max(0, Math.min(D.nDays - 1, d))];
      return '<div class="t-row"><span><i class="swatch" style="background:' + m.color + '"></i><b>' + m.name + '</b>' + (S2.inf[s] ? ' <span class="t-s">· estimado</span>' : '') + '</span><span>' + H.km(S2.km[s]) + '</span></div><div class="t-s">' + H.fmtDay(D.absDay(d), { weekday: true }) + ' · ' + H.fmtClock(S2.t0[s], off) + '–' + H.fmtClock(S2.t1[s], off) + ' · clic para ver el día</div>';
    }
    if (id === 'places' && info.object) {
      const x = info.object;
      return '<b>' + H.esc(D.placeName(x.p)) + '</b><div class="t-s">' + H.esc(D.placeSub(x.p)) + '</div><div class="t-s">' + H.dur(x.min) + ' · ' + H.plural(x.n, 'visita', 'visitas') + '</div>';
    }
    if ((id === 'arcs' || id === 'dests') && info.object) {
      const t = info.object, name = t.ci >= 0 ? D.ds.cities[t.ci].n : H.countryName(t.c);
      return '<b><span class="flag">' + H.flag(H.countryIso(t.c)) + '</span> ' + H.esc(name) + '</b><div class="t-s">' + H.fmtRange(D.absDay(t.d0), D.absDay(t.d1)) + ' · ' + H.plural(t.d1 - t.d0 + 1, 'día', 'días') + '</div><div class="t-s">' + H.km(t.km) + ' recorridos · a ' + H.km(t.far) + ' de casa</div>';
    }
    if (id === 'countries' && info.object) {
      const c = info.object.properties.i, x = D.stats(app.S.f).countries.find((y) => y.c === c);
      return '<b><span class="flag">' + H.flag(H.countryIso(c)) + '</span> ' + H.esc(H.countryName(c)) + '</b>' + (x ? '<div class="t-s">' + H.plural(x.days, 'día', 'días') + (x.km > 0.5 ? ' · ' + H.km(x.km) : '') + '</div><div class="t-s">clic para filtrar</div>' : '');
    }
    if (id === 'hex' && info.object) {
      const o = info.object;
      return '<b>≈ ' + H.dur(o.min) + ' aquí</b><div class="t-s">' + H.plural(o.n, 'registro', 'registros') + ' · más que el ' + Math.round(o.rank * 100) + ' % de las zonas</div>';
    }
    return '';
  }
  function onMapClick(info) {
    if (!app.D || !info || !info.layer) return;
    const D = app.D, id = info.layer.id;
    if (id === 'paths') { const s = segAt(info); if (s >= 0) openDay(D.segDay[s]); }
    else if (id === 'places' && info.object) openPlace(info.object.p);
    else if ((id === 'arcs' || id === 'dests') && info.object) openTrip(info.object);
    else if (id === 'countries' && info.object) { const c = info.object.properties.i; setCountry(app.S.f.c === c ? -1 : c, true); }
  }
  function hexRadiusFor(zoom, lat) {
    const mpp = (156543.03 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    return Math.max(40, Math.min(150000, mpp * 16));
  }
  function onZoomEnd() {
    const S = app.S;
    const z = app.mapView.map.getZoom();
    if (app.D && (S.zoom >= 10.5) !== (z >= 10.5)) { S.zoom = z; renderMap(); }
    S.zoom = z;
    if (!app.D || S.mode !== 'hex') return;
    const m = app.mapView.map, r = hexRadiusFor(m.getZoom(), m.getCenter().lat);
    if (Math.abs(Math.log(r / S.hexRadius)) > 0.35) { S.hexRadius = r; S.hexLat = m.getCenter().lat; renderMap(); }
  }

  // ================================================================ ajustes
  function openSettings() {
    const S = app.S, mv = app.mapView;
    const saved = H.store.info();
    const body = $('#settings-body');
    body.innerHTML =
      '<div class="field"><span class="lbl">Mapa de fondo</span><div class="seg-ctl">' + Object.entries(H.MAP_STYLES).map(([k, s]) => '<button type="button" data-style="' + k + '" aria-pressed="' + ((mv.activeStyle || mv.styleKey) === k) + '">' + H.icon(s.icon) + s.name + '</button>').join('') + '</div></div>' +
      '<label class="switch"><span>Globo terráqueo<small>La Tierra en 3D al alejarte (tecla G)</small></span><input type="checkbox" id="set-globe"' + (mv.globe ? ' checked' : '') + '></label>' +
      '<label class="switch"><span>Mostrar lugares en «Rutas»<small>Círculos donde te detuviste, más grandes cuanto más tiempo</small></span><input type="checkbox" id="set-places"' + (S.showPlaces ? ' checked' : '') + '></label>' +
      '<div class="field"><label for="set-width">Grosor de las rutas</label><input type="range" id="set-width" min="1" max="6" step="0.5" value="' + S.pathWidth + '"></div>' +
      '<div class="field"><label for="set-heat">Radio del mapa de calor</label><input type="range" id="set-heat" min="10" max="70" step="2" value="' + S.heatRadius + '"></div>' +
      '<div class="field"><span class="lbl">Tus datos</span><div class="note">' + (app.isDemo ? 'Estás viendo la <b>demostración</b>. ' : '') + (saved ? 'Hay datos guardados en este navegador (' + H.n0(saved.points) + ' puntos, importados el ' + H.fmtDay(H.localDay(saved.at, -new Date(saved.at).getTimezoneOffset())) + '). Solo están aquí, en tu equipo.' : 'No hay datos guardados en este navegador.') + '</div>' +
      '<div class="seg-ctl">' + (saved ? '<button type="button" id="set-clear">' + H.icon('trash-2') + 'Borrar datos guardados</button>' : '') + '<button type="button" id="set-names">' + H.icon('tag') + 'Olvidar nombres de lugares</button><button type="button" id="set-load">' + H.icon('upload') + 'Cargar otros archivos</button></div></div>';
    $$('[data-style]', body).forEach((b) => b.addEventListener('click', () => { mv.setStyle(b.dataset.style); renderMap(); $$('[data-style]', body).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); }));
    $('#set-globe').addEventListener('change', (e) => { mv.setGlobe(e.target.checked); renderMap(); });
    $('#set-places').addEventListener('change', (e) => { S.showPlaces = e.target.checked; H.storage.set('showPlaces', S.showPlaces); renderMap(); });
    $('#set-width').addEventListener('input', (e) => { S.pathWidth = +e.target.value; H.storage.set('pathWidth', S.pathWidth); renderMapSoon(); });
    $('#set-heat').addEventListener('input', (e) => { S.heatRadius = +e.target.value; H.storage.set('heatRadius', S.heatRadius); if (S.mode !== 'heat') setMode('heat'); else renderMapSoon(); });
    const clr = $('#set-clear');
    if (clr) clr.addEventListener('click', async () => { if (!confirm('¿Borrar los datos guardados en este navegador? Tu archivo original no se toca.')) return; await H.store.clear(); H.toast('Datos borrados de este navegador.'); openSettings(); });
    $('#set-names').addEventListener('click', () => { H.storage.set('placeNames', {}); if (app.D) { app.D.names = {}; renderPanel(false); renderDetail(); } H.toast('Nombres olvidados.'); });
    $('#set-load').addEventListener('click', () => { $('#dlg-settings').close(); goIntro(); });
    if (!$('#dlg-settings').open) $('#dlg-settings').showModal();
  }

  // ================================================================ exportar
  function openExport() {
    const D = app.D, f = effF(), pv = D.points(f), sv = D.segments(f, 'mode', 255);
    const body = $('#export-body');
    body.innerHTML = '<div class="note">' + H.icon('info') + 'Se exporta lo que ves ahora: <b>' + (f.d0 === 0 && f.d1 === D.nDays - 1 ? 'todo tu historial' : H.fmtRange(D.absDay(f.d0), D.absDay(f.d1))) + '</b>' + (f.c >= 0 ? ' en <b>' + H.esc(H.countryName(f.c)) + '</b>' : '') + '.</div>' +
      '<div class="exp-grid">' +
      '<button type="button" class="exp-btn" data-x="png">' + H.icon('image') + '<b>Imagen del mapa</b><span>PNG con la vista actual y un pie con tus cifras</span></button>' +
      '<button type="button" class="exp-btn" data-x="geojson">' + H.icon('map') + '<b>GeoJSON</b><span>' + H.n0(sv.n) + ' tramos y ' + H.n0(D.places(f).length) + ' lugares</span></button>' +
      '<button type="button" class="exp-btn" data-x="gpx">' + H.icon('route') + '<b>GPX</b><span>Recorridos para Strava, Garmin, Google Earth…</span></button>' +
      '<button type="button" class="exp-btn" data-x="csv">' + H.icon('file-json') + '<b>CSV</b><span>' + H.n0(pv.n) + ' puntos con fecha, hora y país</span></button>' +
      '</div>';
    $$('[data-x]', body).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.x;
      try {
        if (k === 'png') exportImage();
        else if (k === 'geojson') exportGeoJSON();
        else if (k === 'gpx') exportGPX();
        else exportCSV();
      } catch (err) { console.error(err); H.toast('No se pudo exportar: ' + err.message, { type: 'warn' }); }
    }));
    $('#dlg-export').showModal();
  }
  function fileStamp() { const D = app.D, f = effF(); return 'huellas_' + new Date(D.absDay(f.d0) * H.DAY).toISOString().slice(0, 10) + '_' + new Date(D.absDay(f.d1) * H.DAY).toISOString().slice(0, 10); }
  function exportImage() {
    const D = app.D, f = storyOverride ? storyOverride.f : effF(), st = D.stats(f);
    renderMap();
    setTimeout(() => {
      const src = app.mapView.snapshot();
      const W = src.width, Hh = src.height, k = W / src.clientWidth || 1;
      const out = document.createElement('canvas');
      out.width = W; out.height = Hh;
      const ctx = out.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const band = 92 * k;
      const g = ctx.createLinearGradient(0, Hh - band * 1.8, 0, Hh);
      g.addColorStop(0, 'rgba(7,8,11,0)'); g.addColorStop(1, 'rgba(7,8,11,0.92)');
      ctx.fillStyle = g; ctx.fillRect(0, Hh - band * 1.8, W, band * 1.8);
      ctx.fillStyle = '#f0efec';
      ctx.font = '700 ' + 30 * k + 'px "Space Grotesk Variable", "Inter Variable", sans-serif';
      ctx.fillText('Huellas', 28 * k, Hh - 50 * k);
      ctx.font = '500 ' + 15 * k + 'px "Inter Variable", sans-serif';
      ctx.fillStyle = '#c3c2b7';
      const range = f.d0 === 0 && f.d1 === D.nDays - 1 ? H.fmtRange(D.absDay(0), D.absDay(D.nDays - 1)) : H.fmtRange(D.absDay(f.d0), D.absDay(f.d1));
      ctx.fillText(range + (f.c >= 0 ? ' · ' + H.countryName(f.c) : '') + '  ·  ' + H.n0(st.totalKm) + ' km  ·  ' + H.plural(st.countries.length, 'país', 'países') + '  ·  ' + H.plural(st.cities.length, 'ciudad', 'ciudades'), 28 * k, Hh - 24 * k);
      out.toBlob((blob) => {
        if (!blob) { H.toast('El navegador no dejó crear la imagen.', { type: 'warn' }); return; }
        H.download(blob, fileStamp() + '.png');
        H.toast('Imagen descargada.', { icon: 'image' });
      }, 'image/png');
    }, 80);
  }
  app.exportImage = exportImage;
  function exportGeoJSON() {
    const D = app.D, f = effF(), sv = D.segments(f, 'mode', 255), S2 = D.ds.segs;
    const feats = [];
    for (let k = 0; k < sv.n; k++) {
      const s = sv.map(k), a = sv.start[k], b = k + 1 < sv.n ? sv.start[k + 1] : sv.pos.length / 2;
      const coords = [];
      for (let v = a; v < b; v++) coords.push([+sv.pos[2 * v].toFixed(6), +sv.pos[2 * v + 1].toFixed(6)]);
      feats.push({ type: 'Feature', properties: { tipo: 'tramo', medio: H.MODES[S2.mode[s]].name, inicio: new Date(S2.t0[s]).toISOString(), fin: new Date(S2.t1[s]).toISOString(), km: +S2.km[s].toFixed(3), pais: H.countryName(S2.c[s]), estimado: !!S2.inf[s] }, geometry: { type: 'LineString', coordinates: coords } });
    }
    for (const x of D.places(f)) feats.push({ type: 'Feature', properties: { tipo: 'lugar', nombre: D.placeName(x.p), visitas: x.n, horas: +(x.min / 60).toFixed(2), placeId: x.place.pid || null }, geometry: { type: 'Point', coordinates: [+x.place.lo.toFixed(6), +x.place.la.toFixed(6)] } });
    H.download(new Blob([JSON.stringify({ type: 'FeatureCollection', features: feats })], { type: 'application/geo+json' }), fileStamp() + '.geojson');
    H.toast('GeoJSON descargado (' + H.n0(feats.length) + ' elementos).', { icon: 'download' });
  }
  function exportGPX() {
    const D = app.D, f = effF(), pv = D.points(f), P = D.ds.pts;
    const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Huellas" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>Huellas</name><trkseg>\n'];
    let last = 0;
    for (let k = 0; k < pv.n; k++) {
      const i = pv.idx ? pv.idx[k] : pv.i0 + k;
      if (last && P.t[i] - last > 6 * 3600000) parts.push('</trkseg><trkseg>\n');
      last = P.t[i];
      parts.push('<trkpt lat="' + P.la[i].toFixed(6) + '" lon="' + P.lo[i].toFixed(6) + '">' + (P.alt[i] === P.alt[i] ? '<ele>' + P.alt[i].toFixed(1) + '</ele>' : '') + '<time>' + new Date(P.t[i]).toISOString() + '</time></trkpt>\n');
    }
    parts.push('</trkseg></trk>\n</gpx>\n');
    H.download(new Blob(parts, { type: 'application/gpx+xml' }), fileStamp() + '.gpx');
    H.toast('GPX descargado (' + H.n0(pv.n) + ' puntos).', { icon: 'download' });
  }
  function exportCSV() {
    const D = app.D, f = effF(), pv = D.points(f), P = D.ds.pts;
    const rows = ['fecha_utc;hora_local;latitud;longitud;pais;ciudad;km_desde_casa;minutos_representados'];
    for (let k = 0; k < pv.n; k++) {
      const i = pv.idx ? pv.idx[k] : pv.i0 + k;
      rows.push(new Date(P.t[i]).toISOString() + ';' + H.fmtDay(H.localDay(P.t[i], P.off[i])) + ' ' + H.fmtClock(P.t[i], P.off[i]) + ';' + P.la[i].toFixed(6) + ';' + P.lo[i].toFixed(6) + ';' + H.countryName(P.c[i]) + ';' + (D.cityName(P.ci[i]) || '') + ';' + P.dh[i].toFixed(2) + ';' + P.w[i].toFixed(1));
    }
    H.download(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }), fileStamp() + '.csv');
    H.toast('CSV descargado (' + H.n0(pv.n) + ' puntos).', { icon: 'download' });
  }

  // ================================================================ nombres de lugares (opcional, OpenStreetMap)
  app.namePlaces = async function (list, btn) {
    const D = app.D;
    let done = 0, named = 0, failed = 0;
    btn.disabled = true;
    for (const pi of list) {
      const p = D.ds.places[pi];
      const key = pi + '|' + p.la.toFixed(4);
      if (p.name || D.names[key]) { done++; continue; }
      btn.innerHTML = H.icon('refresh-cw') + 'Buscando ' + (done + 1) + ' de ' + list.length + '…';
      try {
        const r = await fetch('https://photon.komoot.io/reverse?lat=' + p.la.toFixed(5) + '&lon=' + p.lo.toFixed(5) + '&limit=1', { referrerPolicy: 'no-referrer' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const pr = j.features && j.features[0] && j.features[0].properties;
        if (pr) {
          const street = pr.street ? pr.street + (pr.housenumber ? ' ' + pr.housenumber : '') : '';
          const nm = pr.name && pr.name !== pr.city ? pr.name : street || pr.district || pr.locality || pr.city || '';
          if (nm) { D.names[key] = nm; named++; }
        }
      } catch (e) { failed++; if (failed >= 3) break; }
      done++;
      await new Promise((r) => setTimeout(r, 700));
    }
    H.storage.set('placeNames', D.names);
    renderPanel(false); renderDetail(); renderMap();
    if (failed >= 3 && !named) H.toast('No he podido consultar OpenStreetMap (¿sin conexión?).', { type: 'warn' });
    else H.toast(named + ' lugares con nombre nuevo.', { icon: 'tag' });
  };

  // ================================================================ eventos generales
  function goIntro() {
    stopPlay();
    if (app.story.isOpen()) app.story.close();
    screen('intro');
    app.mapView.forceGlobe = true;
    app.mapView.applyProjection();
    app.mapView.map.easeTo({ zoom: 1.5, pitch: 0, bearing: 0, duration: 1200 });
    setTimeout(() => { if (app$.dataset.screen === 'intro') app.mapView.startSpin(); }, 1300);
    refreshResume();
  }
  function bindApp() {
    $('#brand').addEventListener('click', goIntro);
    $('#btn-load').addEventListener('click', goIntro);
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-export').addEventListener('click', openExport);
    $('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
    $('#btn-story').addEventListener('click', () => app.story.open());
    $('#panel-toggle').addEventListener('click', () => setPanel(app$.dataset.panel === 'closed'));
    $('#country-btn').addEventListener('click', (e) => { if (e.target.closest('[data-clear]')) { setCountry(-1, true); return; } openCountryPicker(); });
    document.addEventListener('pointerdown', (e) => { const pop = $('#country-pop'); if (!pop.hidden && !e.target.closest('#country-picker')) pop.hidden = true; });
    $('#play').addEventListener('click', togglePlay);
    $('#speed').addEventListener('click', () => {
      const a = app.S.anim;
      a.speed = (a.speed + 1) % SPEEDS.length;
      $('#speed').textContent = SPEEDS[a.speed].label;
      clampAnim(); renderMap();
    });
    $('#follow').addEventListener('click', () => {
      const a = app.S.anim;
      a.follow = !a.follow;
      $('#follow').setAttribute('aria-pressed', String(a.follow));
      if (a.follow && a.head) app.mapView.map.easeTo({ center: a.head, zoom: Math.max(app.mapView.map.getZoom(), 11), duration: 800 });
    });
    bindTimeline();
    // en el móvil se empieza con el panel plegado para ver el mapa; se abre tocando una pestaña
    app$.dataset.panel = window.innerWidth <= 760 ? 'closed' : H.storage.get('panel', true) ? 'open' : 'closed';
    window.addEventListener('resize', H.debounce(() => { if (app.D && app$.dataset.screen === 'app') { drawTimeline(); renderPanel(false); } }, 180));
    document.addEventListener('keydown', onKey);
    $$('.dlg').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  }
  function onKey(e) {
    if (e.target.closest('input, select, textarea') && e.key !== 'Escape') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (app.story.isOpen()) {
      if (e.key === 'Escape') { app.story.close(); e.preventDefault(); return; }
      if (app.story.key(e)) e.preventDefault();
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    if (app$.dataset.screen !== 'app' || !app.D) return;
    const S = app.S;
    if (e.key >= '1' && e.key <= '6') { setMode(VIEWS[+e.key - 1].key); e.preventDefault(); }
    else if (e.key === ' ') { togglePlay(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (S.dayView != null) { const x = app.D.nextDay(S.dayView, e.key === 'ArrowLeft' ? -1 : 1); if (x >= 0) openDay(x); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      if (!$('#country-pop').hidden) $('#country-pop').hidden = true;
      else if (S.dayView != null || S.place != null) closeDetail();
      else if (S.f.c >= 0) setCountry(-1, true);
      else if (S.modeMask !== 255) { S.modeMask = 255; renderLegend(); renderMap(); }
    } else if (e.key === 'r' || e.key === 'R') app.story.open();
    else if (e.key === 'e' || e.key === 'E') openExport();
    else if (e.key === 'f' || e.key === 'F') app.mapView.fit(app.D.bboxOf(effF()));
    else if (e.key === 'g' || e.key === 'G') { app.mapView.setGlobe(!app.mapView.globe); renderMap(); H.toast(app.mapView.globe ? 'Globo terráqueo activado' : 'Mapa plano', { icon: 'globe', ms: 1800 }); }
    else if (e.key === '?') $('#dlg-help').showModal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
