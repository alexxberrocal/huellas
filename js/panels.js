/* Huellas · contenido de las pestañas del panel y del panel de detalle (día / lugar). */
(function () {
  'use strict';
  const H = window.H;
  const EARTH = 40075, MOON = 384400;

  H.TABS = [
    { key: 'summary', name: 'Resumen', icon: 'activity' },
    { key: 'countries', name: 'Países', icon: 'flag' },
    { key: 'places', name: 'Lugares', icon: 'map-pin' },
    { key: 'trips', name: 'Viajes', icon: 'luggage' },
    { key: 'patterns', name: 'Patrones', icon: 'calendar-days' },
    { key: 'records', name: 'Récords', icon: 'trophy' },
  ];

  const flag = (c) => '<span class="flag">' + H.flag(H.countryIso(c)) + '</span>';
  const kpi = (icon, label, value, sub, attrs, cls) => '<button class="kpi ' + (cls || '') + '" ' + (attrs || '') + '><div class="kpi-l">' + H.icon(icon) + label + '</div><div class="kpi-v">' + value + '</div>' + (sub ? '<div class="kpi-s">' + sub + '</div>' : '') + '</button>';
  const sec = (title, aside, body, id) => '<section class="sec"' + (id ? ' id="' + id + '"' : '') + '><div class="sec-h"><h3>' + title + '</h3>' + (aside ? '<span class="aside">' + aside + '</span>' : '') + '</div>' + body + '</section>';
  const plIcon = (p) => '<span class="lrow-ic ' + (p.type || '') + '">' + H.icon(p.type === 'home' ? 'house' : p.type === 'work' ? 'briefcase-business' : 'map-pin') + '</span>';

  function compare(km) {
    if (km >= MOON * 0.05) return '≈ ' + H.n1((km / MOON) * 100) + ' % del camino a la Luna';
    if (km >= EARTH * 0.4) return '≈ ' + H.n1(km / EARTH) + ' vueltas a la Tierra';
    if (km >= 505) return '≈ ' + H.n1(km / 505) + ' veces Madrid–Barcelona';
    if (km >= 42.195) return '≈ ' + H.n1(km / 42.195) + ' maratones';
    return km > 0 ? '≈ ' + H.n0((km * 1000) / 105) + ' campos de fútbol' : 'Sin desplazamientos';
  }
  H.compareKm = compare;

  H.Panels = function (app) {
    const P = {};
    const D = () => app.D;
    const S = () => app.S;

    // ------------------------------------------------------------ Resumen
    P.summary = function (body) {
      const d = D(), f = S().f, st = d.stats(f);
      const span = f.d1 - f.d0 + 1;
      const daysAway = st.trips.reduce((a, t) => a + Math.min(t.d1, f.d1) - Math.max(t.d0, f.d0) + 1, 0);
      body.innerHTML =
        '<div class="kpis">' +
        kpi('route', 'Distancia recorrida', H.n0(st.totalKm) + '<small>km</small>', compare(st.totalKm), 'data-go="patterns"', 'hero') +
        kpi('calendar', 'Días registrados', H.n0(st.days), 'de ' + H.plural(span, 'día', 'días') + ' del periodo', 'data-go="patterns"') +
        kpi('earth', 'Países', H.n0(st.countries.length), H.plural(st.continents.size, 'continente', 'continentes'), 'data-go="countries"') +
        kpi('building-2', 'Ciudades', H.n0(st.cities.length), st.cities[0] ? 'sobre todo ' + H.esc(d.cityName(st.cities[0].ci)) : '—', 'data-go="countries"') +
        kpi('map-pin', 'Lugares', H.n0(st.places.length), H.plural(st.places.reduce((a, p) => a + p.n, 0), 'visita', 'visitas'), 'data-go="places"') +
        kpi('luggage', 'Viajes', H.n0(st.trips.length), daysAway ? H.plural(daysAway, 'día', 'días') + ' fuera de casa' : 'a más de 100 km de casa', 'data-go="trips"') +
        kpi('timer', 'En movimiento', H.dur(st.totalMin), st.days ? H.dur(st.totalMin / st.days) + ' y ' + H.km(st.totalKm / st.days) + ' al día' : '', 'data-go="patterns"') +
        '</div>' +
        sec('Cómo te mueves', d.ds.meta.inferredModes ? 'estimado por velocidad' : 'toca para filtrar el mapa', H.charts.modeRows(st, S().modeMask), 'modes-sec') +
        sec('Kilómetros por ' + (f.d1 - f.d0 > 1100 ? 'año' : 'mes'), '', '<div id="ch-monthly"></div>') +
        importInfo();
      H.charts.monthly(body.querySelector('#ch-monthly'), st, f, d);
      body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => app.setTab(b.dataset.go)));
      body.querySelectorAll('.mrow').forEach((b) => b.addEventListener('click', () => app.toggleMode(+b.dataset.mode)));
    };

    function importInfo() {
      const m = D().ds.meta;
      const files = m.files.map((x) => '<li><b>' + H.esc(x.name) + '</b> · ' + H.bytes(x.size) + (x.error ? ' · <span style="color:#ff9b9b">' + H.esc(x.error) + '</span>' : x.items ? ' · ' + H.n0(x.items) + ' registros (' + kindName(x) + ')' : ' · sin ubicaciones') + '</li>').join('');
      const warn = m.warnings.map((w) => '<li>' + H.esc(w) + '</li>').join('');
      const notes = [];
      if (m.inferredModes) notes.push('El archivo no dice cómo te movías: el medio de transporte se estima por la velocidad.');
      if (m.inferredStays) notes.push('Las paradas se han detectado automáticamente (15 min en el mismo sitio).');
      return '<details class="importinfo"><summary>Sobre tus datos · ' + H.n0(m.rawPoints) + ' puntos leídos</summary><ul>' + files + '</ul>' +
        '<div>' + H.n0(m.points) + ' puntos tras limpiar · ' + H.n0(m.visits) + ' visitas · ' + H.n0(m.acts) + ' trayectos · ' + H.n0(m.places) + ' lugares · procesado en ' + H.n1(m.ms / 1000) + ' s</div>' +
        (notes.length ? '<ul>' + notes.map((n) => '<li>' + n + '</li>').join('') + '</ul>' : '') + (warn ? '<ul>' + warn + '</ul>' : '') + '</details>';
    }
    function kindName(x) {
      const k = x.kinds || [];
      if (k.includes('seg')) return k.includes('raw') ? 'Cronología del móvil' : 'Cronología';
      if (k.includes('semantic')) return 'Takeout · historial semántico';
      if (k.includes('records')) return 'Takeout · Records';
      if (k.includes('edits')) return 'Timeline Edits';
      return (x.format || 'datos').toUpperCase();
    }

    // ------------------------------------------------------------ Países y ciudades
    P.countries = function (body) {
      const d = D(), f = S().f, st = d.stats({ d0: f.d0, d1: f.d1, c: -1 });
      if (!st.countries.length) { body.innerHTML = '<div class="empty">No hay países en este periodo.</div>'; return; }
      const maxDays = st.countries[0].days;
      const conts = new Map();
      st.countries.forEach((x) => { const k = H.COUNTRIES[x.c].cont; conts.set(k, (conts.get(k) || 0) + 1); });
      const contChips = '<div class="chips" style="margin-bottom:12px">' + Array.from(conts.entries()).sort((a, b) => b[1] - a[1]).map(([k, n]) => '<span class="badge">' + H.esc(k) + ' · ' + n + '</span>').join('') + '</div>';
      const rows = st.countries.map((x) => '<button class="lrow' + (S().f.c === x.c ? ' sel' : '') + '" data-c="' + x.c + '">' + flag(x.c) +
        '<span class="lrow-main"><div class="lrow-t">' + H.esc(H.countryName(x.c)) + '</div><div class="lrow-s">' + (x.days === 1 ? H.fmtDay(d.absDay(x.first)) : H.fmtDay(d.absDay(x.first)) + ' → ' + H.fmtDay(d.absDay(x.last))) + '</div>' +
        '<div class="lrow-bar"><i style="width:' + Math.max(2, (x.days / maxDays) * 100).toFixed(1) + '%"></i></div></span>' +
        '<span class="lrow-v">' + H.plural(x.days, 'día', 'días') + (x.km > 0.5 ? '<small>' + H.km(x.km) + '</small>' : '') + '</span></button>').join('');
      const cst = d.stats(f);
      const cities = cst.cities.slice(0, app.more.cities);
      const cityRows = cities.map((x) => {
        const c = d.ds.cities[x.ci];
        return '<button class="lrow" data-ci="' + x.ci + '">' + flag(c.c) + '<span class="lrow-main"><div class="lrow-t">' + H.esc(c.n) + '</div><div class="lrow-s">' + H.esc(H.countryName(c.c)) + ' · ' + H.plural(x.days, 'día', 'días') + '</div></span><span class="lrow-v">' + H.dur(x.min) + '</span></button>';
      }).join('');
      body.innerHTML = sec(H.plural(st.countries.length, 'país', 'países'), S().f.c >= 0 ? 'toca otra vez para quitar el filtro' : 'toca uno para filtrar', contChips + '<div class="list">' + rows + '</div>') +
        sec(S().f.c >= 0 ? 'Ciudades en ' + H.esc(H.countryName(S().f.c)) : 'Ciudades', H.n0(cst.cities.length) + ' en total', cities.length ? '<div class="list">' + cityRows + '</div>' + (cst.cities.length > cities.length ? '<button class="btn btn-soft btn-sm more" data-more="cities">Ver más ciudades</button>' : '') : '<div class="empty">Sin ciudades.</div>');
      body.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => app.setCountry(+b.dataset.c === S().f.c ? -1 : +b.dataset.c, true)));
      body.querySelectorAll('[data-ci]').forEach((b) => b.addEventListener('click', () => { const c = d.ds.cities[+b.dataset.ci]; app.mapView.flyTo(c.lo, c.la, 11.5); }));
      const more = body.querySelector('[data-more]');
      if (more) more.addEventListener('click', () => { app.more.cities += 60; app.renderPanel(true); });
    };

    // ------------------------------------------------------------ Lugares
    P.places = function (body) {
      const d = D(), f = S().f, list = d.places(f);
      if (!list.length) { body.innerHTML = '<div class="empty">No hay visitas en este periodo.</div>'; return; }
      const shown = list.slice(0, app.more.places);
      const max = shown[0].min || 1;
      const unnamed = list.slice(0, 40).filter((x) => !x.place.name && !d.names[x.p + '|' + x.place.la.toFixed(4)] && !x.place.type).length;
      const geoNote = unnamed > 3 ? '<div class="note" style="margin-bottom:12px">' + H.icon('info') + 'La exportación del móvil no trae nombres de lugares. <button class="btn btn-soft btn-sm" id="name-places" style="margin-top:8px">' + H.icon('tag') + 'Poner nombre a los 40 principales</button><div class="muted" style="margin-top:6px;font-size:11.5px">Consulta OpenStreetMap con las coordenadas de esos lugares (solo si lo pulsas).</div></div>' : '';
      const rows = shown.map((x) => '<button class="lrow" data-p="' + x.p + '">' + plIcon(x.place) + '<span class="lrow-main"><div class="lrow-t">' + H.esc(d.placeName(x.p)) + '</div><div class="lrow-s">' + H.esc(d.placeSub(x.p) || '') + ' · ' + H.plural(x.n, 'visita', 'visitas') + '</div><div class="lrow-bar"><i style="width:' + Math.max(2, (x.min / max) * 100).toFixed(1) + '%"></i></div></span><span class="lrow-v">' + H.dur(x.min) + '</span></button>').join('');
      body.innerHTML = geoNote + sec(H.plural(list.length, 'lugar', 'lugares'), 'por tiempo pasado', '<div class="list">' + rows + '</div>' + (list.length > shown.length ? '<button class="btn btn-soft btn-sm more" data-more="places">Ver más lugares</button>' : ''));
      body.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => app.openPlace(+b.dataset.p)));
      const more = body.querySelector('[data-more]');
      if (more) more.addEventListener('click', () => { app.more.places += 60; app.renderPanel(true); });
      const nb = body.querySelector('#name-places');
      if (nb) nb.addEventListener('click', () => app.namePlaces(list.slice(0, 40).map((x) => x.p), nb));
    };

    // ------------------------------------------------------------ Viajes
    P.trips = function (body) {
      const d = D(), f = S().f, st = d.stats(f);
      const trips = st.trips.slice().sort((a, b) => b.d0 - a.d0);
      if (!trips.length) { body.innerHTML = '<div class="empty">No hay viajes en este periodo.<br><span class="muted">Un viaje es cuando pasas uno o más días a más de 100 km de casa.</span></div>'; return; }
      const days = trips.reduce((a, t) => a + t.d1 - t.d0 + 1, 0), km = trips.reduce((a, t) => a + t.km, 0);
      const homeC = (d.stats({ d0: 0, d1: d.nDays - 1, c: -1 }).countries[0] || { c: -2 }).c;
      const cards = trips.map((t) => {
        const name = t.ci >= 0 ? d.ds.cities[t.ci].n : H.countryName(t.c);
        const n = t.d1 - t.d0 + 1;
        const extra = t.countries.filter((c) => c !== t.c && c !== homeC).slice(0, 5).map((c) => '<span class="flag" title="' + H.esc(H.countryName(c)) + '">' + H.flag(H.countryIso(c)) + '</span>').join('');
        return '<button class="trip" data-t="' + d.ds.trips.indexOf(t) + '"><span class="trip-flag flag">' + H.flag(H.countryIso(t.c)) + '</span><span style="min-width:0"><div class="trip-t">' + H.esc(name) + (t.c >= 0 ? ', ' + H.esc(H.countryName(t.c)) : '') + '</div><div class="trip-s">' + H.fmtRange(d.absDay(t.d0), d.absDay(t.d1)) + ' · ' + H.plural(n, 'día', 'días') + '</div><div class="trip-m">' +
          (t.mode >= 0 ? '<span style="color:' + H.MODES[t.mode].color + '">' + H.icon(H.MODES[t.mode].icon) + H.MODES[t.mode].short + '</span>' : '') + '<span>' + H.icon('route') + H.km(t.km) + '</span><span>' + H.icon('navigation') + 'a ' + H.km(t.far) + ' de casa</span>' + (extra ? '<span>' + extra + '</span>' : '') + '</div></span></button>';
      }).join('');
      body.innerHTML = '<div class="kpis" style="margin-bottom:16px">' + kpi('luggage', 'Viajes', H.n0(trips.length), H.plural(new Set(trips.map((t) => t.c)).size, 'país', 'países'), '') + kpi('calendar', 'Días fuera', H.n0(days), H.km(km) + ' recorridos', '') + '</div>' + sec('Tus viajes', 'el más reciente primero', cards);
      body.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => app.openTrip(d.ds.trips[+b.dataset.t])));
    };

    // ------------------------------------------------------------ Patrones
    P.patterns = function (body) {
      const d = D(), f = S().f;
      const y0 = new Date(d.absDay(f.d0) * H.DAY).getUTCFullYear(), y1 = new Date(d.absDay(f.d1) * H.DAY).getUTCFullYear();
      const years = d.years.filter((y) => y >= y0 && y <= y1);
      if (!years.includes(app.calYear)) app.calYear = years[years.length - 1] || y1;
      const st = d.stats(f);
      body.innerHTML = sec('Calendario', 'toca un día para verlo', '<div class="cal-years">' + years.map((y) => '<button class="chip chip-sm' + (y === app.calYear ? ' on' : '') + '" data-y="' + y + '">' + y + '</button>').join('') + '</div><div id="ch-cal"></div>') +
        sec('Cuándo te mueves', 'horas en movimiento', '<div id="ch-punch"></div>') +
        sec('Kilómetros por día de la semana', 'media de los días con datos', '<div id="ch-wd"></div>');
      H.charts.calendar(body.querySelector('#ch-cal'), d.calendar(f, app.calYear), app.calYear, { onDay: (day) => app.openDay(day - d.day0), selected: S().dayView != null ? d.absDay(S().dayView) : null });
      H.charts.punch(body.querySelector('#ch-punch'), d.punch(f));
      H.charts.weekday(body.querySelector('#ch-wd'), st, d, f);
      body.querySelectorAll('[data-y]').forEach((b) => b.addEventListener('click', () => { app.calYear = +b.dataset.y; app.renderPanel(true); }));
    };

    // ------------------------------------------------------------ Récords
    P.records = function (body) {
      const d = D(), f = S().f, st = d.stats(f), ex = d.extremes(f);
      const cards = [];
      const card = (icon, color, label, value, sub, act, wide) => cards.push('<button class="rec' + (wide ? ' wide' : '') + '" data-act="' + cards.length + '"><div class="rec-ic" style="background:' + color + '22;color:' + color + '">' + H.icon(icon) + '</div><div class="rec-l">' + label + '</div><div class="rec-v">' + value + '</div><div class="rec-s">' + sub + '</div></button>') && acts.push(act);
      const acts = [];
      if (st.maxDay.d >= 0) card('route', '#3987e5', 'Día más viajero', H.km(st.maxDay.km), H.fmtDay(d.absDay(st.maxDay.d), { weekday: true }), () => app.openDay(st.maxDay.d));
      const far = d.pointInfo(ex.far);
      if (far && far.dh > 1) card('navigation', '#d55181', 'Lo más lejos de casa', H.km(far.dh), H.esc(d.where(far.ci, far.c)) + ' · ' + H.fmtDay(d.absDay(far.d)), () => { app.openDay(far.d); app.mapView.flyTo(far.lo, far.la, 11); });
      const longTrip = st.trips.slice().sort((a, b) => (b.d1 - b.d0) - (a.d1 - a.d0))[0];
      if (longTrip) card('luggage', '#9085e9', 'Viaje más largo', H.plural(longTrip.d1 - longTrip.d0 + 1, 'día', 'días'), H.esc(longTrip.ci >= 0 ? d.ds.cities[longTrip.ci].n : H.countryName(longTrip.c)) + ' · ' + H.fmtRange(d.absDay(longTrip.d0), d.absDay(longTrip.d1)), () => app.openTrip(longTrip));
      const L = st.longest;
      const routeSub = (x) => (x.from >= 0 && x.to >= 0 && x.from !== x.to ? H.esc(d.cityName(x.from)) + ' → ' + H.esc(d.cityName(x.to)) + ' · ' : '') + H.fmtDay(d.absDay(x.d));
      if (L.plane) card('plane', H.MODES[6].color, 'Vuelo más largo', H.km(L.plane.km), routeSub(L.plane), () => app.openDay(L.plane.d));
      if (L.car) card('car', H.MODES[0].color, 'Trayecto en coche más largo', H.km(L.car.km), routeSub(L.car), () => app.openDay(L.car.d));
      if (L.train) card('train-front', H.MODES[4].color, 'Trayecto en tren más largo', H.km(L.train.km), routeSub(L.train), () => app.openDay(L.train.d));
      if (L.walk) card('footprints', H.MODES[1].color, 'Caminata más larga', H.km(L.walk.km), H.dur((L.walk.e - L.walk.s) / 60000) + ' · ' + H.fmtDay(d.absDay(L.walk.d)), () => app.openDay(L.walk.d));
      if (L.bike) card('bike', H.MODES[2].color, 'Ruta en bici más larga', H.km(L.bike.km), H.fmtDay(d.absDay(L.bike.d)), () => app.openDay(L.bike.d));
      if (st.mostCountries.n > 1) card('flag', '#199e70', 'Más países en un día', H.n0(st.mostCountries.n), H.fmtDay(d.absDay(st.mostCountries.d), { weekday: true }), () => app.openDay(st.mostCountries.d));
      const fav = st.places.find((x) => !x.place.type);
      if (fav) card('star', '#c98500', 'Tu sitio favorito (sin contar casa ni trabajo)', H.dur(fav.min), H.esc(d.placeName(fav.p)) + ' · ' + H.plural(fav.n, 'visita', 'visitas'), () => app.openPlace(fav.p));
      let bestM = null;
      for (const [k, arr] of st.months) { const v = arr.reduce((a, b) => a + b, 0); if (!bestM || v > bestM.v) bestM = { k, v }; }
      if (bestM && bestM.v > 0) card('calendar-days', '#3987e5', 'Mes con más kilómetros', H.km(bestM.v), H.fmtMonth(Math.floor(bestM.k / 12), bestM.k % 12, true), () => { const y = Math.floor(bestM.k / 12), m = bestM.k % 12; app.setRange(Math.floor(Date.UTC(y, m, 1) / H.DAY) - d.day0, Math.floor(Date.UTC(y, m + 1, 0) / H.DAY) - d.day0, true); });
      const ptCard = (key, icon, label) => {
        const p = d.pointInfo(ex[key]);
        if (!p) return;
        card(icon, '#c3c2b7', label, H.esc(d.where(p.ci, p.c).split(',')[0]), H.n1(Math.abs(p.la)) + '° ' + (p.la >= 0 ? 'N' : 'S') + ', ' + H.n1(Math.abs(p.lo)) + '° ' + (p.lo >= 0 ? 'E' : 'O') + ' · ' + H.fmtDay(d.absDay(p.d)), () => { app.mapView.flyTo(p.lo, p.la, 10); });
      };
      ptCard('n', 'arrow-up', 'Lo más al norte');
      ptCard('s', 'arrow-down', 'Lo más al sur');
      ptCard('e', 'arrow-right', 'Lo más al este');
      ptCard('w', 'arrow-left', 'Lo más al oeste');
      const alt = d.pointInfo(ex.alt);
      if (alt && alt.alt > 50) card('mountain', '#199e70', 'Mayor altitud registrada', H.n0(alt.alt) + ' m', H.esc(d.where(alt.ci, alt.c)) + ' · ' + H.fmtDay(d.absDay(alt.d)), () => app.mapView.flyTo(alt.lo, alt.la, 12));
      body.innerHTML = cards.length ? '<div class="records">' + cards.join('') + '</div>' : '<div class="empty">Sin récords en este periodo.</div>';
      body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => acts[+b.dataset.act]()));
    };

    // ------------------------------------------------------------ detalle: un día
    P.day = function (el, dIdx) {
      const d = D(), info = d.day(dIdx);
      const abs = d.absDay(dIdx);
      const where = info.cities.length ? H.esc(d.cityName(info.cities[0].ci)) + (info.countries[0] ? ', ' + H.esc(H.countryName(info.countries[0].c)) : '') : info.countries[0] ? H.esc(H.countryName(info.countries[0].c)) : '';
      const visits = info.items.filter((x) => x.type === 'visit');
      const moveMin = info.items.filter((x) => x.type === 'move').reduce((a, x) => a + (Math.min(x.e, info.ms1) - Math.max(x.s, info.ms0)) / 60000, 0);
      const prev = d.nextDay(dIdx, -1), next = d.nextDay(dIdx, 1);
      const stops = d.dayStops(dIdx);
      let items = '';
      for (const it of info.items) {
        const clipS = Math.max(it.s, info.ms0);
        const when = it.s < info.ms0 ? '<span title="Desde el día anterior">··</span>' : H.fmtClock(it.s, it.off);
        if (it.type === 'visit') {
          const p = d.ds.places[it.p];
          items += '<li><span class="when">' + when + '</span><span class="rail"><span class="dot num' + (p && p.type ? ' home' : '') + '">' + (stops.get(it.p) || '') + '</span></span><button class="what" data-p="' + it.p + '"><b>' + H.esc(d.placeName(it.p)) + '</b><span>' + H.dur((Math.min(it.e, info.ms1) - clipS) / 60000) + ' · hasta ' + (it.e > info.ms1 ? 'el día siguiente' : H.fmtClock(it.e, it.off)) + '</span></button></li>';
        } else {
          const m = H.MODES[it.mode];
          const route = it.from >= 0 && it.to >= 0 && it.from !== it.to ? ' · ' + H.esc(d.cityName(it.from)) + ' → ' + H.esc(d.cityName(it.to)) : '';
          items += '<li class="move-row"><span class="when">' + when + '</span><span class="rail"><span class="dot move" style="background:' + m.color + '">' + H.icon(m.icon) + '</span></span><button class="what" data-s="' + it.s + '" data-e="' + it.e + '"><b>' + m.name + (it.inf ? ' <span class="badge">estimado</span>' : '') + '</b><span>' + H.km(it.km) + ' · ' + H.dur((it.e - it.s) / 60000) + route + '</span></button></li>';
        }
      }
      el.innerHTML = '<div class="d-head"><div class="d-title"><div class="d-kicker">' + (d.weekday(dIdx) === 0 || d.weekday(dIdx) === 6 ? 'Fin de semana' : 'Día') + '</div><h2 class="d-h">' + H.fmtDay(abs, { weekday: true, long: true }) + '</h2><div class="d-sub">' + (where || '&nbsp;') + ' · ' + H.fmtTz(info.off) + '</div></div>' +
        '<div class="d-nav"><button class="icon-btn icon-btn-sm" data-nav="-1" title="Día anterior con datos (←)"' + (prev < 0 ? ' disabled' : '') + '>' + H.icon('chevron-left') + '</button><button class="icon-btn icon-btn-sm" data-nav="1" title="Día siguiente con datos (→)"' + (next < 0 ? ' disabled' : '') + '>' + H.icon('chevron-right') + '</button><button class="icon-btn icon-btn-sm" data-close title="Cerrar (Esc)">' + H.icon('x') + '</button></div></div>' +
        '<div class="d-stats"><div class="d-stat"><b>' + H.km(info.km) + '</b><span>recorridos</span></div><div class="d-stat"><b>' + new Set(visits.map((v) => v.p)).size + '</b><span>lugares</span></div><div class="d-stat"><b>' + H.dur(moveMin) + '</b><span>en movimiento</span></div></div>' +
        '<div class="d-actions"><button class="btn btn-soft btn-sm" data-play>' + H.icon('play') + 'Reproducir el día</button><button class="btn btn-soft btn-sm" data-fit>' + H.icon('maximize-2') + 'Encuadrar</button></div>' +
        (info.items.length ? '<ol class="itin">' + items + '</ol>' : '<div class="empty">No hay visitas ni trayectos este día' + (info.points ? ' (solo ' + H.plural(info.points, 'punto suelto', 'puntos sueltos') + ')' : '') + '.</div>');
      el.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => { const x = d.nextDay(dIdx, +b.dataset.nav); if (x >= 0) app.openDay(x); }));
      el.querySelector('[data-close]').addEventListener('click', () => app.closeDetail());
      el.querySelector('[data-play]').addEventListener('click', () => app.playDay(dIdx));
      el.querySelector('[data-fit]').addEventListener('click', () => app.mapView.fit(info.bbox));
      el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { const p = d.ds.places[+b.dataset.p]; app.mapView.flyTo(p.lo, p.la, Math.max(app.mapView.map.getZoom(), 15)); }));
      el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
        const s = +b.dataset.s, e = +b.dataset.e, P2 = d.ds.pts;
        const i0 = H.lowerBound(P2.t, s), i1 = H.lowerBound(P2.t, e + 1);
        let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
        for (let i = Math.max(0, i0 - 1); i < Math.min(d.N, i1 + 1); i++) { x0 = Math.min(x0, P2.lo[i]); x1 = Math.max(x1, P2.lo[i]); y0 = Math.min(y0, P2.la[i]); y1 = Math.max(y1, P2.la[i]); }
        app.mapView.fit([x0, y0, x1, y1], { maxZoom: 16 });
      }));
      return info;
    };

    // ------------------------------------------------------------ detalle: un lugar
    P.place = function (el, pi) {
      const d = D(), p = d.ds.places[pi], V = d.ds.visits;
      const mine = [];
      for (let i = 0; i < V.p.length; i++) if (V.p[i] === pi) mine.push(i);
      const total = mine.reduce((a, i) => a + (V.e[i] - V.s[i]) / 60000, 0);
      const byMonth = new Map();
      for (const i of mine) { const x = new Date(V.s[i] + V.off[i] * 60000); const k = x.getUTCFullYear() * 12 + x.getUTCMonth(); byMonth.set(k, (byMonth.get(k) || 0) + 1); }
      const keys = Array.from(byMonth.keys());
      const kmin = Math.min(...keys), kmax = Math.max(...keys);
      const bars = [];
      for (let k = Math.max(kmin, kmax - 35); k <= kmax; k++) bars.push(byMonth.get(k) || 0);
      const bmax = Math.max(1, ...bars);
      const kicker = p.type === 'home' ? 'Casa' : p.type === 'work' ? 'Trabajo' : 'Lugar';
      const gm = 'https://www.google.com/maps/search/?api=1&query=' + p.la.toFixed(6) + '%2C' + p.lo.toFixed(6) + (p.pid ? '&query_place_id=' + encodeURIComponent(p.pid) : '');
      const recent = mine.slice(-40).reverse().map((i) => '<button class="lrow" data-day="' + (H.localDay(V.s[i], V.off[i]) - d.day0) + '"><span class="lrow-ic">' + H.icon('calendar') + '</span><span class="lrow-main"><div class="lrow-t">' + H.fmtDay(H.localDay(V.s[i], V.off[i]), { weekday: true }) + '</div><div class="lrow-s">' + H.fmtClock(V.s[i], V.off[i]) + ' – ' + H.fmtClock(V.e[i], V.off[i]) + '</div></span><span class="lrow-v">' + H.dur((V.e[i] - V.s[i]) / 60000) + '</span></button>').join('');
      el.innerHTML = '<div class="d-head"><div class="d-title"><div class="d-kicker">' + kicker + '</div><h2 class="d-h">' + H.esc(d.placeName(pi, { plain: true })) + '</h2><div class="d-sub">' + H.esc(d.placeSub(pi)) + '</div></div><div class="d-nav"><button class="icon-btn icon-btn-sm" data-close title="Cerrar (Esc)">' + H.icon('x') + '</button></div></div>' +
        '<div class="d-stats"><div class="d-stat"><b>' + H.n0(mine.length) + '</b><span>visitas</span></div><div class="d-stat"><b>' + H.dur(total) + '</b><span>en total</span></div><div class="d-stat"><b>' + H.dur(mine.length ? total / mine.length : 0) + '</b><span>por visita</span></div></div>' +
        '<div class="d-actions"><a class="btn btn-soft btn-sm" href="' + gm + '" target="_blank" rel="noopener noreferrer">' + H.icon('external-link') + 'Abrir en Google Maps</a><button class="btn btn-soft btn-sm" data-fly>' + H.icon('crosshair') + 'Centrar</button></div>' +
        sec('Visitas por mes', bars.length + ' meses', '<div class="mini-bars">' + bars.map((v) => '<i style="height:' + Math.max(2, (v / bmax) * 100) + '%" title="' + v + '"></i>').join('') + '</div><div class="scale"><span>' + H.fmtMonth(Math.floor(Math.max(kmin, kmax - 35) / 12), Math.max(kmin, kmax - 35) % 12) + '</span><span style="flex:1"></span><span>' + H.fmtMonth(Math.floor(kmax / 12), kmax % 12) + '</span></div>') +
        '<div class="muted" style="font-size:12px;margin:-10px 0 16px">Primera visita ' + H.fmtDay(H.localDay(p.first, 0)) + ' · última ' + H.fmtDay(H.localDay(p.last, 0)) + '</div>' +
        sec('Últimas visitas', '', '<div class="visit-list list">' + recent + '</div>');
      el.querySelector('[data-close]').addEventListener('click', () => app.closeDetail());
      el.querySelector('[data-fly]').addEventListener('click', () => app.mapView.flyTo(p.lo, p.la, 16));
      el.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => app.openDay(+b.dataset.day)));
    };

    return P;
  };
})();
