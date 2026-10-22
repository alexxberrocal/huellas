/* Huellas · modelo de datos en la página: filtros (fechas y país), vistas para el mapa y estadísticas. */
(function () {
  'use strict';
  const H = window.H;
  const DAY = H.DAY, MIN = 60000, NM = H.NM;
  const lb = H.lowerBound;

  // ---------------------------------------------------------------- países (para nombres y para el mapa)
  H.COUNTRIES = window.HUELLAS_COUNTRIES;
  let geo = null;
  H.countryGeo = function () {
    if (geo) return geo;
    const features = H.COUNTRIES.map((c, i) => {
      const polys = c.p.map((rings) => rings.map((str) => {
        const v = str.split(',');
        const out = [];
        let x = 0, y = 0;
        for (let k = 0; k < v.length; k += 2) { x += +v[k]; y += +v[k + 1]; out.push([x / 1000, y / 1000]); }
        if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0].slice());
        return out;
      }));
      let minX = 180, minY = 90, maxX = -180, maxY = -90, big = 0, cx = 0, cy = 0;
      for (const poly of polys) {
        const r = poly[0];
        let a = 0, sx = 0, sy = 0;
        for (const [x, y] of r) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        for (let k = 0; k < r.length - 1; k++) { const f = r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1]; a += f; sx += (r[k][0] + r[k + 1][0]) * f; sy += (r[k][1] + r[k + 1][1]) * f; }
        if (Math.abs(a) > big && a) { big = Math.abs(a); cx = sx / (3 * a); cy = sy / (3 * a); }
      }
      c.bbox = [minX, minY, maxX, maxY];
      c.center = [cx, cy];
      return { type: 'Feature', id: i, properties: { i, name: c.name, iso: c.iso }, geometry: { type: 'MultiPolygon', coordinates: polys } };
    });
    geo = { type: 'FeatureCollection', features };
    return geo;
  };
  H.countryName = (i) => (i >= 0 && H.COUNTRIES[i] ? H.COUNTRIES[i].name : 'Mar o zona sin país');
  H.countryIso = (i) => (i >= 0 && H.COUNTRIES[i] ? H.COUNTRIES[i].iso : '');

  // ---------------------------------------------------------------- dataset
  H.Data = class Data {
    constructor(ds) {
      H.countryGeo();
      this.ds = ds;
      const P = ds.pts, S = ds.segs;
      const N = (this.N = P.t.length);
      this.day0 = ds.days.day0;
      this.nDays = ds.days.n;
      this.T0 = ds.meta.T0;
      const pos = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) { pos[2 * i] = P.lo[i]; pos[2 * i + 1] = P.la[i]; }
      this.pos = pos;
      // peso suavizado (logaritmo del tiempo): así casa no eclipsa todo en el calor y el 3D
      const ws = new Float32Array(N);
      for (let i = 0; i < N; i++) ws[i] = Math.log1p(Math.max(0, P.w[i]));
      this.ws = ws;
      this.nSeg = S.mode.length;
      this.nVtx = S.ts.length;
      const offAt = (ms) => { if (!N) return 0; let q = lb(P.t, ms); if (q >= N) q = N - 1; return P.off[q]; };
      this.segDay = new Int32Array(this.nSeg);
      for (let s = 0; s < this.nSeg; s++) this.segDay[s] = H.localDay(S.t0[s], offAt(S.t0[s])) - this.day0;
      const A = ds.acts;
      this.actDay = new Int32Array(A.s.length);
      this.dayHasAct = new Uint8Array(this.nDays);
      for (let i = 0; i < A.s.length; i++) {
        const d = H.localDay(A.s[i], A.off[i]) - this.day0;
        this.actDay[i] = d;
        if (d >= 0 && d < this.nDays) this.dayHasAct[d] = 1;
      }
      const V = ds.visits;
      this.visDay = new Int32Array(V.s.length);
      for (let i = 0; i < V.s.length; i++) this.visDay[i] = H.localDay(V.s[i], V.off[i]) - this.day0;
      this.visMaxLen = 0;
      for (let i = 0; i < V.s.length; i++) this.visMaxLen = Math.max(this.visMaxLen, V.e[i] - V.s[i]);
      // años con datos
      const ys = new Set();
      for (let d = 0; d < this.nDays; d++) if (ds.days.pts[d] > 0) ys.add(new Date((this.day0 + d) * DAY).getUTCFullYear());
      this.years = Array.from(ys).sort((a, b) => a - b);
      this.homePlace = ds.places.findIndex((p) => p.type === 'home');
      this.workPlace = ds.places.findIndex((p) => p.type === 'work');
      this.names = H.storage.get('placeNames', {});
      this._cc = new Map();
      this._cs = new Map();
      this._colors = {};
      this._memo = new Map();
    }

    // instante UTC de la medianoche local del día d (relativo a day0)
    dayMs(d) {
      const o = this.ds.days.off[Math.max(0, Math.min(this.nDays - 1, d))];
      return (this.day0 + d) * DAY - o * MIN;
    }
    absDay(d) { return this.day0 + d; }
    dayOfYear(y) { return Math.floor(Date.UTC(y, 0, 1) / DAY) - this.day0; }
    weekday(d) { return (this.day0 + d + 4) % 7; }

    memo(key, fn) {
      if (this._memo.has(key)) return this._memo.get(key);
      const v = fn();
      if (this._memo.size > 60) this._memo.delete(this._memo.keys().next().value);
      this._memo.set(key, v);
      return v;
    }
    fkey(f) { return f.d0 + '|' + f.d1 + '|' + f.c; }

    countryPoints(c) {
      let v = this._cc.get(c);
      if (!v) {
        const pc = this.ds.pts.c;
        let n = 0;
        for (let i = 0; i < this.N; i++) if (pc[i] === c) n++;
        v = new Uint32Array(n);
        let k = 0;
        for (let i = 0; i < this.N; i++) if (pc[i] === c) v[k++] = i;
        this._cc.set(c, v);
      }
      return v;
    }
    countrySegs(c) {
      let v = this._cs.get(c);
      if (!v) {
        const sc = this.ds.segs.c;
        const arr = [];
        for (let s = 0; s < this.nSeg; s++) if (sc[s] === c) arr.push(s);
        v = Uint32Array.from(arr);
        this._cs.set(c, v);
      }
      return v;
    }

    // ------------------------------------------------------------ vistas para el mapa
    points(f) {
      return this.memo('p' + this.fkey(f), () => {
        const t = this.ds.pts.t, w = this.ds.pts.w;
        const i0 = lb(t, this.dayMs(f.d0)), i1 = lb(t, this.dayMs(f.d1 + 1));
        if (f.c < 0) return { n: i1 - i0, pos: this.pos.subarray(2 * i0, 2 * i1), w: w.subarray(i0, i1), ws: this.ws.subarray(i0, i1), i0, idx: null };
        const list = this.countryPoints(f.c);
        const a = lb(list, i0), b = lb(list, i1), n = b - a;
        const pos = new Float32Array(2 * n), ww = new Float32Array(n), ws = new Float32Array(n);
        for (let k = 0; k < n; k++) { const i = list[a + k]; pos[2 * k] = this.pos[2 * i]; pos[2 * k + 1] = this.pos[2 * i + 1]; ww[k] = w[i]; ws[k] = this.ws[i]; }
        return { n, pos, w: ww, ws, i0: -1, idx: list.subarray(a, b) };
      });
    }

    vertexColors(by) {
      if (this._colors[by]) return this._colors[by];
      const S = this.ds.segs;
      const out = new Uint8Array(this.nVtx * 4);
      const years = this.years, y0 = years[0] || 2000, y1 = years[years.length - 1] || y0;
      for (let s = 0; s < this.nSeg; s++) {
        let rgb;
        if (by === 'year') {
          const y = new Date(S.t0[s]).getUTCFullYear();
          rgb = H.yearColor(y, y0, y1);
        } else rgb = H.MODES[S.mode[s]].rgb;
        for (let v = S.start[s]; v < S.start[s + 1]; v++) { out[4 * v] = rgb[0]; out[4 * v + 1] = rgb[1]; out[4 * v + 2] = rgb[2]; out[4 * v + 3] = 255; }
      }
      this._colors[by] = out;
      return out;
    }

    segments(f, by, modeMask) {
      return this.memo('s' + this.fkey(f) + '|' + by + '|' + modeMask, () => {
        const S = this.ds.segs;
        const s0 = lb(S.t0, this.dayMs(f.d0)), s1 = lb(S.t0, this.dayMs(f.d1 + 1));
        const colors = this.vertexColors(by);
        const all = modeMask === 255;
        if (f.c < 0 && all) {
          const v0 = S.start[s0], v1 = S.start[s1], n = s1 - s0;
          const start = new Uint32Array(n);
          for (let k = 0; k < n; k++) start[k] = S.start[s0 + k] - v0;
          return { n, start, pos: S.pos.subarray(2 * v0, 2 * v1), ts: S.ts.subarray(v0, v1), col: colors.subarray(4 * v0, 4 * v1), map: (k) => s0 + k };
        }
        const list = [];
        if (f.c >= 0) { const cs = this.countrySegs(f.c); for (let k = lb(cs, s0); k < cs.length && cs[k] < s1; k++) if (modeMask & (1 << S.mode[cs[k]])) list.push(cs[k]); }
        else for (let s = s0; s < s1; s++) if (modeMask & (1 << S.mode[s])) list.push(s);
        let V = 0;
        for (const s of list) V += S.start[s + 1] - S.start[s];
        const pos = new Float32Array(2 * V), ts = new Float32Array(V), col = new Uint8Array(4 * V), start = new Uint32Array(list.length);
        let v = 0;
        list.forEach((s, k) => {
          start[k] = v;
          const a = S.start[s], b = S.start[s + 1];
          pos.set(S.pos.subarray(2 * a, 2 * b), 2 * v);
          ts.set(S.ts.subarray(a, b), v);
          col.set(colors.subarray(4 * a, 4 * b), 4 * v);
          v += b - a;
        });
        return { n: list.length, start, pos, ts, col, map: (k) => list[k] };
      });
    }

    // ------------------------------------------------------------ lugares y visitas
    visitRange(ms0, ms1) {
      const V = this.ds.visits;
      const a = lb(V.s, ms0 - this.visMaxLen), b = lb(V.s, ms1);
      return [a, b];
    }
    places(f) {
      return this.memo('pl' + this.fkey(f), () => {
        const V = this.ds.visits, P = this.ds.places;
        const ms0 = this.dayMs(f.d0), ms1 = this.dayMs(f.d1 + 1);
        const a = lb(V.s, ms0), b = lb(V.s, ms1);
        const agg = new Map();
        for (let i = a; i < b; i++) {
          if (f.c >= 0 && V.c[i] !== f.c) continue;
          const p = V.p[i];
          let x = agg.get(p);
          if (!x) agg.set(p, (x = { p, n: 0, min: 0, first: V.s[i], last: V.e[i], off: V.off[i] }));
          x.n++;
          x.min += (Math.min(V.e[i], ms1) - V.s[i]) / MIN;
          x.last = V.e[i];
        }
        const out = Array.from(agg.values()).sort((x, y) => y.min - x.min);
        out.forEach((x) => { x.place = P[x.p]; });
        return out;
      });
    }
    placeName(pi, opts) {
      const p = this.ds.places[pi];
      if (!p) return 'Lugar';
      const named = p.name || this.names[pi + '|' + p.la.toFixed(4)] || '';
      if (p.type === 'home') return opts && opts.plain ? 'Casa' : named ? 'Casa · ' + named : 'Casa';
      if (p.type === 'work') return named ? 'Trabajo · ' + named : 'Trabajo';
      if (named) return named;
      const city = this.ds.cities[p.ci];
      return city ? 'Lugar en ' + city.n : 'Lugar sin nombre';
    }
    placeSub(pi) {
      const p = this.ds.places[pi];
      if (!p) return '';
      const city = this.ds.cities[p.ci];
      const parts = [];
      if (p.addr) parts.push(p.addr);
      else if (city) parts.push(city.n);
      if (p.c >= 0) parts.push(H.countryName(p.c));
      return parts.join(' · ');
    }

    // ------------------------------------------------------------ estadísticas del filtro
    stats(f) {
      return this.memo('st' + this.fkey(f), () => {
        const ds = this.ds, A = ds.acts, S = ds.segs, D = ds.days;
        const ms0 = this.dayMs(f.d0), ms1 = this.dayMs(f.d1 + 1);
        const km = new Float64Array(NM), min = new Float64Array(NM);
        const months = new Map(); // año*12+mes → Float64Array(NM)
        const addMonth = (d, m, v) => {
          const x = new Date((this.day0 + d) * DAY);
          const key = x.getUTCFullYear() * 12 + x.getUTCMonth();
          let arr = months.get(key);
          if (!arr) months.set(key, (arr = new Float64Array(NM)));
          arr[m] += v;
        };
        const dayKm = new Float64Array(f.d1 - f.d0 + 1);
        const a0 = lb(A.s, ms0), a1 = lb(A.s, ms1);
        let longest = { plane: null, walk: null, car: null, bike: null, train: null };
        const PLANE = 6;
        for (let i = a0; i < a1; i++) {
          if (f.c >= 0 && (A.c[i] !== f.c || (A.mode[i] === PLANE && A.c2[i] !== f.c))) continue;
          const m = A.mode[i];
          km[m] += A.km[i]; min[m] += (A.e[i] - A.s[i]) / MIN;
          const d = this.actDay[i];
          addMonth(d, m, A.km[i]);
          if (d >= f.d0 && d <= f.d1) dayKm[d - f.d0] += A.km[i];
          const key = H.MODES[m].key;
          if (key in longest && (!longest[key] || A.km[i] > longest[key].km)) longest[key] = { km: A.km[i], s: A.s[i], e: A.e[i], off: A.off[i], from: A.ci1[i], to: A.ci2[i], d };
        }
        const s0 = lb(S.t0, ms0), s1 = lb(S.t0, ms1);
        for (let s = s0; s < s1; s++) {
          const d = this.segDay[s];
          if (d >= 0 && d < this.nDays && this.dayHasAct[d]) continue;
          if (f.c >= 0 && (S.c[s] !== f.c || (S.mode[s] === PLANE && S.c2[s] !== f.c))) continue;
          const m = S.mode[s];
          km[m] += S.km[s]; min[m] += (S.t1[s] - S.t0[s]) / MIN;
          addMonth(d, m, S.km[s]);
          if (d >= f.d0 && d <= f.d1) dayKm[d - f.d0] += S.km[s];
          const key = H.MODES[m].key;
          if (key in longest && (!longest[key] || S.km[s] > longest[key].km)) longest[key] = { km: S.km[s], s: S.t0[s], e: S.t1[s], off: D.off[Math.max(0, d)], d, from: -1, to: -1 };
        }
        // países y ciudades
        const DC = ds.dayCountry, a = lb(DC.d, f.d0), b = lb(DC.d, f.d1 + 1);
        const cmap = new Map(), countryDays = new Map();
        const perDayCountries = new Map();
        for (let i = a; i < b; i++) {
          const c = DC.c[i];
          if (f.c >= 0 && c !== f.c) continue;
          let x = cmap.get(c);
          if (!x) cmap.set(c, (x = { c, days: 0, min: 0, km: 0, first: DC.d[i], last: DC.d[i] }));
          x.days++; x.min += DC.min[i]; x.km += DC.km[i]; x.last = DC.d[i];
          perDayCountries.set(DC.d[i], (perDayCountries.get(DC.d[i]) || 0) + 1);
          countryDays.set(DC.d[i], 1);
        }
        const countries = Array.from(cmap.values()).filter((x) => x.c >= 0).sort((x, y) => y.days - x.days || y.min - x.min);
        const DCI = ds.dayCity, ca = lb(DCI.d, f.d0), cb = lb(DCI.d, f.d1 + 1);
        const cimap = new Map();
        for (let i = ca; i < cb; i++) {
          const ci = DCI.ci[i];
          const city = ds.cities[ci];
          if (!city || (f.c >= 0 && city.c !== f.c)) continue;
          let x = cimap.get(ci);
          if (!x) cimap.set(ci, (x = { ci, days: 0, min: 0, first: DCI.d[i], last: DCI.d[i] }));
          x.days++; x.min += DCI.min[i]; x.last = DCI.d[i];
        }
        const cities = Array.from(cimap.values()).filter((x) => x.min >= 20).sort((x, y) => y.min - x.min);
        let days = 0;
        if (f.c < 0) { for (let d = f.d0; d <= f.d1; d++) if (D.pts[d] > 0) days++; }
        else days = countryDays.size;
        const trips = ds.trips.filter((t) => t.d1 >= f.d0 && t.d0 <= f.d1 && (f.c < 0 || t.countries.includes(f.c)));
        const places = this.places(f);
        const continents = new Set(countries.map((x) => H.COUNTRIES[x.c] && H.COUNTRIES[x.c].cont).filter((x) => x && x !== 'Océanos'));
        let totalKm = 0, totalMin = 0;
        for (let m = 0; m < NM; m++) { totalKm += km[m]; totalMin += min[m]; }
        let mostCountries = { n: 0, d: -1 };
        for (const [d, n] of perDayCountries) if (n > mostCountries.n) mostCountries = { n, d };
        let maxDay = { km: 0, d: -1 };
        dayKm.forEach((v, k) => { if (v > maxDay.km) maxDay = { km: v, d: f.d0 + k }; });
        return { km, min, totalKm, totalMin, months, dayKm, days, countries, cities, trips, places, continents, longest, mostCountries, maxDay };
      });
    }

    // extremos geográficos y distancia a casa en el filtro
    extremes(f) {
      return this.memo('ex' + this.fkey(f), () => {
        const P = this.ds.pts, v = this.points(f);
        let n = -1, s = -1, e = -1, w = -1, far = -1, alt = -1;
        const at = (k) => (v.idx ? v.idx[k] : v.i0 + k);
        for (let k = 0; k < v.n; k++) {
          const i = at(k);
          if (P.air && P.air[i]) continue; // en pleno vuelo no cuenta
          if (n < 0 || P.la[i] > P.la[n]) n = i;
          if (s < 0 || P.la[i] < P.la[s]) s = i;
          if (e < 0 || P.lo[i] > P.lo[e]) e = i;
          if (w < 0 || P.lo[i] < P.lo[w]) w = i;
          if (far < 0 || P.dh[i] > P.dh[far]) far = i;
          if (P.alt[i] === P.alt[i] && P.alt[i] < 9000 && (alt < 0 || P.alt[i] > P.alt[alt])) alt = i;
        }
        return { n, s, e, w, far, alt };
      });
    }
    pointInfo(i) {
      const P = this.ds.pts;
      if (i < 0) return null;
      return { i, la: P.la[i], lo: P.lo[i], t: P.t[i], off: P.off[i], c: P.c[i], ci: P.ci[i], dh: P.dh[i], alt: P.alt[i], d: H.localDay(P.t[i], P.off[i]) - this.day0 };
    }
    cityName(ci) { const c = this.ds.cities[ci]; return c ? c.n : ''; }
    where(ci, c) {
      const city = this.ds.cities[ci];
      if (city) return city.n + (city.c >= 0 ? ', ' + H.countryName(city.c) : '');
      return c >= 0 ? H.countryName(c) : 'En medio de la nada';
    }

    // ------------------------------------------------------------ patrones
    calendar(f, year) {
      const d0 = this.dayOfYear(year), d1 = this.dayOfYear(year + 1) - 1;
      const vals = new Float32Array(d1 - d0 + 1), has = new Uint8Array(d1 - d0 + 1);
      const st = this.stats({ d0: Math.max(0, d0), d1: Math.min(this.nDays - 1, d1), c: f.c });
      for (let d = Math.max(0, d0); d <= Math.min(this.nDays - 1, d1); d++) {
        vals[d - d0] = st.dayKm[d - Math.max(0, d0)] || 0;
        has[d - d0] = this.ds.days.pts[d] > 0 ? 1 : 0;
      }
      if (f.c >= 0) {
        has.fill(0);
        const DC = this.ds.dayCountry;
        for (let i = lb(DC.d, d0); i < DC.d.length && DC.d[i] <= d1; i++) if (DC.c[i] === f.c) has[DC.d[i] - d0] = 1;
      }
      return { d0, vals, has };
    }
    punch(f) {
      return this.memo('pu' + this.fkey(f), () => {
        const out = new Float64Array(7 * 24);
        const hm = this.ds.days.hourMove;
        let only = null;
        if (f.c >= 0) {
          only = new Set();
          const DC = this.ds.dayCountry;
          for (let i = lb(DC.d, f.d0); i < DC.d.length && DC.d[i] <= f.d1; i++) if (DC.c[i] === f.c) only.add(DC.d[i]);
        }
        for (let d = f.d0; d <= f.d1; d++) {
          if (only && !only.has(d)) continue;
          const wd = this.weekday(d);
          for (let h = 0; h < 24; h++) out[wd * 24 + h] += hm[d * 24 + h] || 0;
        }
        return out;
      });
    }

    // ------------------------------------------------------------ un día concreto
    day(d) {
      const ds = this.ds, V = ds.visits, A = ds.acts, S = ds.segs, P = ds.pts;
      const ms0 = this.dayMs(d), ms1 = this.dayMs(d + 1);
      const items = [];
      const [va, vb] = this.visitRange(ms0, ms1);
      for (let i = va; i < vb; i++) {
        if (V.e[i] <= ms0 || V.s[i] >= ms1) continue;
        items.push({ type: 'visit', s: V.s[i], e: V.e[i], off: V.off[i], p: V.p[i], i });
      }
      const aa = lb(A.s, ms0 - 2 * DAY), ab = lb(A.s, ms1);
      let hasActs = false;
      for (let i = aa; i < ab; i++) {
        if (A.e[i] <= ms0) continue;
        hasActs = true;
        items.push({ type: 'move', s: A.s[i], e: A.e[i], off: A.off[i], mode: A.mode[i], km: A.km[i], from: A.ci1[i], to: A.ci2[i], inf: !!A.inf[i] });
      }
      if (!hasActs) {
        // sin actividades (Records.json, GPX): se agrupan los tramos seguidos del mismo medio
        const s0 = lb(S.t0, ms0), s1 = lb(S.t0, ms1);
        let cur = null;
        for (let s = s0; s < s1; s++) {
          if (cur && cur.mode === S.mode[s] && S.t0[s] - cur.e < 10 * MIN) { cur.e = S.t1[s]; cur.km += S.km[s]; continue; }
          cur = { type: 'move', s: S.t0[s], e: S.t1[s], off: ds.days.off[d], mode: S.mode[s], km: S.km[s], from: -1, to: -1, inf: !!S.inf[s] };
          items.push(cur);
        }
      }
      items.sort((x, y) => x.s - y.s || (x.type === 'visit' ? -1 : 1));
      const i0 = lb(P.t, ms0), i1 = lb(P.t, ms1);
      let minX = 180, minY = 90, maxX = -180, maxY = -90;
      const grow = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
      for (let i = i0; i < i1; i++) grow(P.lo[i], P.la[i]);
      for (const it of items) if (it.type === 'visit') { const p = ds.places[it.p]; if (p) grow(p.lo, p.la); }
      const st = this.stats({ d0: d, d1: d, c: -1 });
      return { d, ms0, ms1, items, km: st.totalKm, kmByMode: st.km, countries: st.countries, cities: st.cities, points: i1 - i0, bbox: minX <= maxX ? [minX, minY, maxX, maxY] : null, off: ds.days.off[d] };
    }
    // lugar → número de parada (1, 2, 3…) según el primer paso por él ese día
    dayStops(d) {
      return this.memo('stops' + d, () => {
        const out = new Map();
        for (const it of this.day(d).items) if (it.type === 'visit' && !out.has(it.p) && this.ds.places[it.p]) out.set(it.p, out.size + 1);
        return out;
      });
    }
    nextDay(d, dir) {
      const pts = this.ds.days.pts;
      for (let x = d + dir; x >= 0 && x < this.nDays; x += dir) if (pts[x] > 0) return x;
      return -1;
    }

    // posición interpolada en un instante (animación)
    positionAt(ms) {
      const P = this.ds.pts;
      if (!this.N) return null;
      const q = lb(P.t, ms);
      if (q <= 0) return { lo: P.lo[0], la: P.la[0], i: 0 };
      if (q >= this.N) return { lo: P.lo[this.N - 1], la: P.la[this.N - 1], i: this.N - 1 };
      const a = q - 1, f = (ms - P.t[a]) / Math.max(1, P.t[q] - P.t[a]);
      if (P.t[q] - P.t[a] > 6 * 3600000 && H.hav(P.la[a], P.lo[a], P.la[q], P.lo[q]) > 300) return { lo: P.lo[a], la: P.la[a], i: a };
      return { lo: P.lo[a] + (P.lo[q] - P.lo[a]) * f, la: P.la[a] + (P.la[q] - P.la[a]) * f, i: f < 0.5 ? a : q };
    }

    // rejilla hexagonal propia (en Mercator, con el tamaño real a la latitud del centro de la vista)
    hexBins(f, radius, lat0) {
      return this.memo('hx' + this.fkey(f) + '|' + Math.round(radius) + '|' + Math.round(lat0), () => {
        const pv = this.points(f), RE = 6378137, R2D = 180 / Math.PI, D2R = Math.PI / 180;
        const rm = radius / Math.max(0.05, Math.cos(lat0 * D2R));
        const bins = new Map();
        const S3 = Math.sqrt(3);
        for (let k = 0; k < pv.n; k++) {
          const lon = pv.pos[2 * k], lat = Math.max(-85, Math.min(85, pv.pos[2 * k + 1]));
          const x = RE * lon * D2R, y = RE * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
          // coordenadas axiales de un hexágono «de punta» y redondeo cúbico
          const qf = ((S3 / 3) * x - y / 3) / rm, rf = ((2 / 3) * y) / rm, sf = -qf - rf;
          let q = Math.round(qf), r = Math.round(rf);
          const s = Math.round(sf);
          const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
          if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
          const key = q * 4194304 + r;
          let b = bins.get(key);
          if (!b) bins.set(key, (b = { q, r, w: 0, min: 0, n: 0 }));
          b.w += pv.ws[k]; b.min += pv.w[k]; b.n++;
        }
        const out = Array.from(bins.values());
        for (const b of out) {
          const x = rm * S3 * (b.q + b.r / 2), y = rm * 1.5 * b.r;
          b.pos = [(x / RE) * R2D, (2 * Math.atan(Math.exp(y / RE)) - Math.PI / 2) * R2D];
        }
        out.sort((a, b) => a.w - b.w);
        out.forEach((b, i) => { b.rank = out.length > 1 ? i / (out.length - 1) : 1; });
        const top = out.length ? Math.log1p(out[out.length - 1].w) : 1;
        out.forEach((b) => { b.h = Math.log1p(b.w) / Math.max(1e-9, top); });
        return out;
      });
    }

    bboxOf(f) {
      const v = this.points(f);
      if (!v.n) return null;
      // percentiles para que un único punto perdido no aleje el encuadre
      const xs = new Float32Array(v.n), ys = new Float32Array(v.n);
      for (let k = 0; k < v.n; k++) { xs[k] = v.pos[2 * k]; ys[k] = v.pos[2 * k + 1]; }
      xs.sort(); ys.sort();
      const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))];
      const p = v.n > 200 ? 0.002 : 0;
      return [q(xs, p), q(ys, p), q(xs, 1 - p), q(ys, 1 - p)];
    }
  };

  // color por año: rampa análoga azul → violeta → magenta → naranja (más reciente = más cálido)
  const YEAR_RAMP = ['#3987e5', '#6f74e3', '#9085e9', '#b468c4', '#d55181', '#e66767', '#eb6834', '#eda100'];
  H.YEAR_RAMP = YEAR_RAMP;
  H.yearColor = (y, y0, y1) => H.rampAt(YEAR_RAMP, y1 > y0 ? (y - y0) / (y1 - y0) : 1);
})();
