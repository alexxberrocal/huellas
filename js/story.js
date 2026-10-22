/* Huellas · «Tu resumen»: diapositivas animadas con el mapa volando de fondo. */
(function () {
  'use strict';
  const H = window.H;
  const DURATION = 7000;

  H.Story = function (app) {
    const el = document.getElementById('story');
    const stage = document.getElementById('story-stage');
    const bars = document.getElementById('story-bars');
    const sel = document.getElementById('story-year');
    let slides = [], idx = 0, timer = 0, startedAt = 0, paused = false, open = false;

    function periods() {
      const D = app.D, out = [{ key: 'all', label: 'Toda tu historia', f: { d0: 0, d1: D.nDays - 1, c: -1 } }];
      for (const y of D.years.slice().reverse()) {
        const d0 = Math.max(0, D.dayOfYear(y)), d1 = Math.min(D.nDays - 1, D.dayOfYear(y + 1) - 1);
        if (d1 >= d0) out.push({ key: String(y), label: 'Tu ' + y, f: { d0, d1, c: -1 }, year: y });
      }
      const f = app.S.f;
      if (!(f.d0 === 0 && f.d1 === D.nDays - 1 && f.c < 0) && !out.some((p) => p.f.d0 === f.d0 && p.f.d1 === f.d1 && f.c < 0)) {
        out.splice(1, 0, { key: 'filter', label: 'El periodo filtrado', f: { d0: f.d0, d1: f.d1, c: f.c } });
      }
      return out;
    }

    function build(period) {
      const D = app.D, f = period.f, st = D.stats(f), ex = D.extremes(f);
      const title = period.year ? String(period.year) : period.key === 'filter' ? H.fmtRange(D.absDay(f.d0), D.absDay(f.d1)) : 'Toda tu historia';
      const bbox = D.bboxOf(f);
      const out = [];
      out.push({
        mode: 'routes', fly: () => app.mapView.fit(bbox, { duration: 2600 }),
        html: '<div class="k">Tu resumen</div><h2 class="big grad" style="font-size:clamp(64px,13vw,140px)">' + H.esc(title) + '</h2><p>' + H.plural(st.days, 'día registrado', 'días registrados') + ' · ' + H.fmtDay(D.absDay(f.d0)) + ' → ' + H.fmtDay(D.absDay(f.d1)) + '</p>',
      });
      if (st.totalKm > 0) {
        out.push({
          mode: 'anim', fly: () => app.mapView.fit(bbox, { duration: 2400, pitch: 30 }),
          html: '<div class="k">Distancia</div><div class="big">' + H.n0(st.totalKm) + '<small> km</small></div><p>' + H.compareKm(st.totalKm) + '.</p><p>Una media de ' + H.km(st.days ? st.totalKm / st.days : 0) + ' al día y ' + H.dur(st.totalMin) + ' en movimiento.</p>',
        });
        const order = H.MODES.map((m, i) => i).filter((i) => st.km[i] > 0).sort((a, b) => st.km[b] - st.km[a]).slice(0, 5);
        const top = order[0];
        out.push({
          mode: 'routes', fly: () => app.mapView.fit(bbox, { duration: 2000, pitch: 0 }),
          html: '<div class="k">Cómo te moviste</div><h2>Sobre todo, ' + H.MODES[top].name.toLowerCase() + '</h2><div class="s-bars">' + order.map((m) => '<div class="s-bar">' + H.charts.modeIcon(m) + '<div><div style="display:flex;justify-content:space-between;margin-bottom:5px"><span>' + H.MODES[m].name + '</span><span style="color:var(--ink-2)">' + H.km(st.km[m]) + '</span></div><div class="track"><i data-w="' + ((st.km[m] / st.km[top]) * 100).toFixed(1) + '" style="background:' + H.MODES[m].color + '"></i></div></div><span></span></div>').join('') + '</div>',
          after: () => setTimeout(() => stage.querySelectorAll('.track i').forEach((i) => { i.style.width = i.dataset.w + '%'; }), 60),
        });
      }
      if (st.countries.length) {
        let bb = null;
        for (const x of st.countries.slice(0, 12)) { const b = H.COUNTRIES[x.c].bbox; if (!b) continue; bb = bb ? [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])] : b.slice(); }
        out.push({
          mode: 'countries', fly: () => app.mapView.fit(bb, { duration: 2600, pitch: 0, maxZoom: 5 }),
          html: '<div class="k">Países</div><div class="big">' + st.countries.length + '</div><p>' + (st.countries.length === 1 ? 'Un país' : 'Países') + ' en ' + H.plural(st.continents.size, 'continente', 'continentes') + (st.countries.length > 1 ? '. El que más: ' + H.esc(H.countryName(st.countries[0].c)) + ' (' + H.plural(st.countries[0].days, 'día', 'días') + ')' : '') + '.</p><div class="flags">' + st.countries.slice(0, 40).map((x, i) => '<span title="' + H.esc(H.countryName(x.c)) + '" style="animation-delay:' + (i * 70) + 'ms">' + H.flag(H.countryIso(x.c)) + '</span>').join('') + '</div>',
        });
      }
      if (st.cities.length) {
        const top = st.cities.slice(0, 5);
        const c0 = D.ds.cities[top[0].ci];
        out.push({
          mode: 'heat', fly: () => app.mapView.flyTo(c0.lo, c0.la, 10.5, { duration: 3000, pitch: 0 }),
          html: '<div class="k">Ciudades</div><h2>' + H.plural(st.cities.length, 'ciudad', 'ciudades') + '</h2><div class="s-list">' + top.map((x) => { const c = D.ds.cities[x.ci]; return '<div><span><span class="flag">' + H.flag(H.countryIso(c.c)) + '</span> ' + H.esc(c.n) + '</span><span>' + H.dur(x.min) + '</span></div>'; }).join('') + '</div>',
        });
      }
      if (st.trips.length) {
        const longest = st.trips.slice().sort((a, b) => (b.d1 - b.d0) - (a.d1 - a.d0))[0];
        const daysAway = st.trips.reduce((a, t) => a + t.d1 - t.d0 + 1, 0);
        let bb = null;
        for (const t of st.trips) { const b = [Math.min(t.hlo, t.dlo), Math.min(t.hla, t.dla), Math.max(t.hlo, t.dlo), Math.max(t.hla, t.dla)]; bb = bb ? [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])] : b; }
        out.push({
          mode: 'trips', fly: () => app.mapView.fit(bb, { duration: 2600, pitch: 35, maxZoom: 6 }),
          html: '<div class="k">Viajes</div><div class="big">' + st.trips.length + '</div><p>' + H.plural(daysAway, 'día', 'días') + ' a más de 100 km de casa.</p><p>El más largo: <b>' + H.esc(longest.ci >= 0 ? D.ds.cities[longest.ci].n : H.countryName(longest.c)) + '</b>, ' + H.plural(longest.d1 - longest.d0 + 1, 'día', 'días') + ' (' + H.fmtRange(D.absDay(longest.d0), D.absDay(longest.d1)) + ').</p>',
        });
      }
      const far = D.pointInfo(ex.far);
      if (far && far.dh > 50) {
        out.push({
          mode: 'routes', fly: () => app.mapView.flyTo(far.lo, far.la, 6, { duration: 3200, pitch: 0 }),
          html: '<div class="k">Lo más lejos que llegaste</div><div class="big">' + H.n0(far.dh) + '<small> km</small></div><p>de casa, en <b>' + H.esc(D.where(far.ci, far.c)) + '</b>, el ' + H.fmtDay(D.absDay(far.d), { long: true }) + '.</p>',
        });
      }
      const fav = st.places.find((x) => !x.place.type);
      const home = st.places.find((x) => x.place.type === 'home');
      if (fav) {
        const pct = home && st.days ? Math.min(100, (home.min / (st.days * 1440)) * 100) : 0;
        out.push({
          mode: 'routes', fly: () => app.mapView.flyTo(fav.place.lo, fav.place.la, 15.5, { duration: 3000, pitch: 45 }),
          html: '<div class="k">Tu rincón favorito</div><h2>' + H.esc(D.placeName(fav.p)) + '</h2><p>' + H.dur(fav.min) + ' en ' + H.plural(fav.n, 'visita', 'visitas') + '.</p>' + (pct > 1 ? '<p>Y en casa pasaste el ' + Math.round(pct) + ' % del tiempo registrado.</p>' : ''),
        });
      }
      const pu = D.punch(f);
      let best = 0;
      for (let i = 1; i < pu.length; i++) if (pu[i] > pu[best]) best = i;
      if (pu[best] > 0) {
        const wd = Math.floor(best / 24), h = best % 24;
        out.push({
          mode: 'heat', fly: () => app.mapView.fit(bbox, { duration: 2400, pitch: 0 }),
          html: '<div class="k">Tu ritmo</div><h2>Te mueves más los ' + H.DIAL[wd] + (wd === 6 || wd === 0 ? '' : '') + ' hacia las ' + h + ':00</h2>' + (st.maxDay.d >= 0 ? '<p>Tu día más viajero fue el ' + H.fmtDay(D.absDay(st.maxDay.d), { weekday: true, long: true }) + ': ' + H.km(st.maxDay.km) + '.</p>' : ''),
        });
      }
      out.push({
        mode: 'routes', fly: () => app.mapView.fit(bbox, { duration: 2400, pitch: 0 }),
        html: '<div class="k">Y esto es solo el principio</div><h2>Sigue explorando tu mapa</h2><p>Filtra por fechas o países, abre cualquier día o reproduce tus viajes.</p><div class="s-actions"><button class="btn btn-primary" data-x="img">' + H.icon('image') + 'Guardar imagen</button><button class="btn btn-ghost" data-x="close">' + H.icon('map') + 'Ir al mapa</button></div>',
        after: () => {
          stage.querySelector('[data-x="img"]').addEventListener('click', () => app.exportImage());
          stage.querySelector('[data-x="close"]').addEventListener('click', close);
        },
        final: true,
      });
      return out;
    }

    function show(i) {
      if (!open) return;
      idx = Math.max(0, Math.min(slides.length - 1, i));
      const s = slides[idx];
      stage.innerHTML = '<div class="slide">' + s.html + '</div>';
      bars.innerHTML = slides.map((_, k) => '<i class="' + (k < idx ? 'done' : '') + '"><b></b></i>').join('');
      app.storyView(s.mode, period.f);
      try { s.fly(); } catch (e) { /* encuadre imposible: se queda donde está */ }
      if (s.after) s.after();
      clearTimeout(timer);
      startedAt = performance.now();
      const bar = bars.children[idx] && bars.children[idx].firstChild;
      if (bar && !s.final) {
        bar.style.transition = 'none';
        bar.style.width = '0';
        requestAnimationFrame(() => { bar.style.transition = 'width ' + DURATION + 'ms linear'; bar.style.width = paused ? '0' : '100%'; });
        if (!paused) timer = setTimeout(() => show(idx + 1), DURATION);
      } else if (bar) bar.style.width = '100%';
    }

    let period = null;
    function start(key) {
      const ps = periods();
      period = ps.find((p) => p.key === key) || ps[0];
      sel.value = period.key;
      slides = build(period);
      show(0);
    }

    function openStory() {
      if (!app.D) return;
      const ps = periods();
      sel.innerHTML = ps.map((p) => '<option value="' + p.key + '">' + H.esc(p.label) + '</option>').join('');
      // por defecto, el último año con bastantes datos
      let key = 'all';
      for (const p of ps) if (p.year && app.D.stats(p.f).days >= 60) { key = p.key; break; }
      if (ps.some((p) => p.key === 'filter')) key = 'filter';
      open = true;
      paused = false;
      el.hidden = false;
      document.getElementById('app').dataset.story = 'on';
      start(key);
    }
    function close() {
      if (!open) return;
      open = false;
      clearTimeout(timer);
      el.hidden = true;
      delete document.getElementById('app').dataset.story;
      app.storyView(null);
    }

    sel.addEventListener('change', () => start(sel.value));
    document.getElementById('story-close').addEventListener('click', close);
    document.getElementById('story-prev').addEventListener('click', () => show(idx - 1));
    document.getElementById('story-next').addEventListener('click', () => (idx >= slides.length - 1 ? close() : show(idx + 1)));
    stage.addEventListener('click', (e) => {
      if (e.target.closest('button, a, select')) return;
      const x = e.clientX / window.innerWidth;
      if (x < 0.3) show(idx - 1); else show(idx + 1);
    });

    return {
      open: openStory, close,
      isOpen: () => open,
      key(e) {
        if (e.key === 'ArrowRight') { show(idx + 1); return true; }
        if (e.key === 'ArrowLeft') { show(idx - 1); return true; }
        if (e.key === ' ') { paused = !paused; show(idx); return true; }
        return false;
      },
    };
  };
})();
