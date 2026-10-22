/* Huellas · mapa base (MapLibre) + capas de datos (deck.gl) dibujadas en el mismo lienzo. */
(function () {
  'use strict';
  const H = window.H;

  function offlineStyle() {
    return {
      version: 8,
      name: 'Huellas sin conexión',
      sources: { countries: { type: 'geojson', data: H.countryGeo() } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0a0c11' } },
        { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': '#171a21' } },
        { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': '#2b2f39', 'line-width': 0.7 } },
      ],
    };
  }
  function satelliteStyle() {
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    return {
      version: 8,
      name: 'Satélite',
      sources: {
        sat: { type: 'raster', tiles: [esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics' },
        ref: { type: 'raster', tiles: [esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#05070a' } },
        { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.78, 'raster-saturation': -0.2, 'raster-contrast': 0.05 } },
        { id: 'ref', type: 'raster', source: 'ref', paint: { 'raster-opacity': 0.85 } },
      ],
    };
  }
  const CARTO = 'https://basemaps.cartocdn.com/gl/';
  H.MAP_STYLES = {
    dark: { name: 'Noche', icon: 'moon', url: CARTO + 'dark-matter-gl-style/style.json' },
    voyager: { name: 'Color', icon: 'map', url: CARTO + 'voyager-gl-style/style.json' },
    light: { name: 'Claro', icon: 'sun', url: CARTO + 'positron-gl-style/style.json' },
    satellite: { name: 'Satélite', icon: 'earth', build: satelliteStyle },
    offline: { name: 'Sin conexión', icon: 'globe', build: offlineStyle },
  };

  H.MapView = class MapView {
    constructor(container) {
      this.styleKey = H.storage.get('mapStyle', 'dark');
      if (!H.MAP_STYLES[this.styleKey]) this.styleKey = 'dark';
      this.globe = H.storage.get('globe', false);
      this.forceGlobe = true; // en la portada siempre se ve el globo
      this.loaded = false;
      this.waiters = [];
      this.onHover = null;
      this.onClick = null;
      this.onFallback = null;
      this.map = new maplibregl.Map({
        container,
        style: this.styleFor(this.styleKey),
        center: [6, 28], zoom: 1.5, minZoom: 0.5, maxZoom: 19, maxPitch: 78,
        attributionControl: false, fadeDuration: 0,
        // MapLibre 5: hace falta conservar el lienzo para poder exportarlo como imagen
        canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
        renderWorldCopies: true, dragRotate: true, touchPitch: true,
      });
      this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
      this.overlay = new deck.MapboxOverlay({
        interleaved: true,
        layers: [],
        pickingRadius: 6,
        onHover: (info) => this.onHover && this.onHover(info),
        onClick: (info, ev) => this.onClick && this.onClick(info, ev),
        getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      });
      this.map.addControl(this.overlay);
      this.armFallback();
      this.map.on('style.load', () => {
        this.styleOk = true;
        clearTimeout(this.fallbackTimer);
        this.applyProjection();
        this.spanishLabels();
        // halo de atmósfera alrededor del globo (solo se ve con zoom alejado)
        try {
          this.map.setSky({
            'sky-color': '#0b1020', 'horizon-color': '#24305e', 'fog-color': '#0b0d12',
            'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.6,
            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.9, 7, 0],
          });
        } catch (e) { /* versión sin cielo */ }
      });
      this.map.on('error', (e) => {
        const msg = String((e && e.error && (e.error.message || e.error.status)) || '');
        if (!this.styleOk && this.styleKey !== 'offline') this.fallback(msg);
      });
      this.map.once('load', () => {
        this.loaded = true;
        this.waiters.splice(0).forEach((f) => f());
        // créditos plegados en un botón (i): no tapan el mapa
        document.querySelectorAll('.maplibregl-ctrl-attrib').forEach((e) => e.classList.remove('maplibregl-compact-show'));
      });
      this.map.on('webglcontextlost', () => { this.contextLost = true; });
    }

    styleFor(key) {
      const s = H.MAP_STYLES[key];
      return s.build ? s.build() : s.url;
    }
    armFallback() {
      clearTimeout(this.fallbackTimer);
      this.styleOk = false;
      this.fallbackTimer = setTimeout(() => { if (!this.styleOk) this.fallback('tiempo de espera agotado'); }, 9000);
    }
    fallback(why) {
      if (this.styleKey === 'offline' || this.inFallback) return;
      this.inFallback = true;
      console.warn('Mapa base no disponible (' + why + '); uso el mapa sin conexión');
      this.map.setStyle(offlineStyle());
      this.activeStyle = 'offline';
      if (this.onFallback) this.onFallback();
      setTimeout(() => { this.inFallback = false; }, 1000);
    }
    whenReady(fn) { if (this.loaded) fn(); else this.waiters.push(fn); }

    // Los mapas de CARTO rotulan en inglés: se pide primero el nombre en español si el dato lo tiene.
    spanishLabels() {
      try {
        for (const l of this.map.getStyle().layers) {
          if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) continue;
          const tf = JSON.stringify(l.layout['text-field']);
          if (tf.indexOf('"name:en"') < 0) continue;
          const es = tf.split('["get","name:en"]').join('["coalesce",["get","name:es"],["get","name:en"]]');
          this.map.setLayoutProperty(l.id, 'text-field', JSON.parse(es));
        }
      } catch (e) { /* estilo sin etiquetas compatibles */ }
    }

    setStyle(key) {
      if (!H.MAP_STYLES[key]) return;
      this.styleKey = key;
      this.activeStyle = key;
      H.storage.set('mapStyle', key);
      this.armFallback();
      this.map.setStyle(this.styleFor(key), { diff: false });
    }
    setGlobe(on) {
      this.globe = !!on;
      H.storage.set('globe', this.globe);
      this.applyProjection();
    }
    applyProjection() {
      try { this.map.setProjection({ type: this.globe || this.forceGlobe ? 'globe' : 'mercator' }); } catch (e) { /* versión sin globo */ }
    }

    setLayers(layers) { this.overlay.setProps({ layers }); }

    padding() {
      const app = document.getElementById('app');
      const css = getComputedStyle(document.documentElement);
      const px = (v) => parseFloat(css.getPropertyValue(v)) || 0;
      const gap = px('--gap'), mobile = window.innerWidth <= 760;
      if (app.dataset.story === 'on') return { top: 80, bottom: 80, left: 60, right: 60 };
      const pad = { top: px('--top-h') + gap * 3, bottom: px('--tl-h') + gap * 3, left: gap * 3, right: gap * 3 };
      if (mobile) {
        if (app.dataset.detail === 'open') pad.top += Math.min(window.innerHeight * 0.46, 430) + gap;
        if (app.dataset.panel !== 'closed') pad.bottom += Math.min(window.innerHeight * 0.46, 430) + gap;
        else pad.bottom += 50 + gap;
      } else {
        if (app.dataset.panel !== 'closed') pad.left += px('--panel-w') + gap;
        if (app.dataset.detail === 'open') pad.right += px('--detail-w') + gap;
      }
      // con ventanas pequeñas el relleno no puede comerse todo el mapa
      const maxH = window.innerHeight * 0.8, maxW = window.innerWidth * 0.8;
      if (pad.top + pad.bottom > maxH) { const k = maxH / (pad.top + pad.bottom); pad.top *= k; pad.bottom *= k; }
      if (pad.left + pad.right > maxW) { const k = maxW / (pad.left + pad.right); pad.left *= k; pad.right *= k; }
      return pad;
    }
    fit(bbox, opts) {
      if (!bbox) return;
      opts = opts || {};
      let [x0, y0, x1, y1] = bbox;
      if (!(x1 >= x0 && y1 >= y0)) return;
      if (x1 - x0 < 0.004 && y1 - y0 < 0.004) {
        this.map.flyTo({ center: [(x0 + x1) / 2, (y0 + y1) / 2], zoom: opts.pointZoom || 15, duration: opts.duration ?? 1400, padding: this.padding(), essential: true });
        return;
      }
      // ojo: MapLibre trata «pitch: undefined» como NaN y rompe la cámara; solo se pasan si vienen dados
      const o = { padding: this.padding(), maxZoom: opts.maxZoom || 15.5, duration: opts.duration == null ? 1400 : opts.duration, essential: true };
      if (opts.pitch != null) o.pitch = opts.pitch;
      if (opts.bearing != null) o.bearing = opts.bearing;
      try {
        const cam = this.map.cameraForBounds([[x0, y0], [x1, y1]], o);
        if (!cam || !(cam.zoom >= 0)) { o.padding = 20; }
        this.map.fitBounds([[x0, y0], [x1, y1]], o);
      } catch (e) { /* la caja no cabe con este relleno: se ignora */ }
    }
    flyTo(lon, lat, zoom, opts) {
      if (!(lon >= -540 && lon <= 540 && lat >= -90 && lat <= 90)) return;
      const o = { center: [lon, lat], zoom: zoom == null ? this.map.getZoom() : zoom, duration: 1400, padding: this.padding(), essential: true };
      for (const [k, v] of Object.entries(opts || {})) if (v != null) o[k] = v;
      this.map.flyTo(o);
    }

    startSpin() {
      if (this.spinning) return;
      this.spinning = true;
      let last = performance.now();
      const step = (now) => {
        if (!this.spinning) return;
        const dt = Math.min(64, now - last);
        last = now;
        if (!this.map.isMoving() || this.spinOnly) {
          const c = this.map.getCenter();
          this.spinOnly = true;
          this.map.jumpTo({ center: [c.lng + dt * 0.0035, c.lat] });
        }
        this.spinRaf = requestAnimationFrame(step);
      };
      this.spinRaf = requestAnimationFrame(step);
      const stop = () => { this.spinOnly = false; };
      this.map.on('mousedown', stop);
      this.map.on('touchstart', stop);
    }
    stopSpin() { this.spinning = false; cancelAnimationFrame(this.spinRaf); }

    snapshot() {
      try { this.map.triggerRepaint(); } catch (e) { /* sin mapa */ }
      return this.map.getCanvas();
    }
  };

  // ---------------------------------------------------------------- capas
  function greatCircle(lo1, la1, lo2, la2) {
    const R = Math.PI / 180, out = [];
    const p1 = [la1 * R, lo1 * R], p2 = [la2 * R, lo2 * R];
    const d = 2 * Math.asin(Math.sqrt(Math.sin((p2[0] - p1[0]) / 2) ** 2 + Math.cos(p1[0]) * Math.cos(p2[0]) * Math.sin((p2[1] - p1[1]) / 2) ** 2));
    if (!(d > 1e-6)) return [[lo1, la1], [lo2, la2]];
    const n = Math.max(8, Math.min(96, Math.round(d * 60)));
    let prev = lo1;
    for (let i = 0; i <= n; i++) {
      const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(p1[0]) * Math.cos(p1[1]) + B * Math.cos(p2[0]) * Math.cos(p2[1]);
      const y = A * Math.cos(p1[0]) * Math.sin(p1[1]) + B * Math.cos(p2[0]) * Math.sin(p2[1]);
      const z = A * Math.sin(p1[0]) + B * Math.sin(p2[0]);
      let lon = Math.atan2(y, x) / R;
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
      prev = lon;
      out.push([lon, Math.atan2(z, Math.sqrt(x * x + y * y)) / R]);
    }
    return out;
  }
  const HEAT = H.RAMP_HEAT.slice(2).map((h) => H.hexRgb(h));
  H.HEAT_COLORS = HEAT;
  const WHITE = [240, 239, 236];
  const FONT = '"Inter Variable", Inter, system-ui, "Segoe UI", sans-serif';

  function binaryPaths(sv) {
    return { length: sv.n, startIndices: sv.start, attributes: { getPath: { value: sv.pos, size: 2 }, getColor: { value: sv.col, size: 4, normalized: true } } };
  }
  function pathLayer(id, sv, o) {
    return new deck.PathLayer({
      id, data: binaryPaths(sv), _pathType: 'open',
      widthUnits: 'pixels', getWidth: o.width || 2, widthMinPixels: 1, capRounded: true, jointRounded: true,
      opacity: o.opacity == null ? 0.9 : o.opacity, pickable: !!o.pickable, autoHighlight: !!o.pickable, highlightColor: [255, 255, 255, 230],
      updateTriggers: { getWidth: o.width },
    });
  }
  // Quita etiquetas que se pisarían en pantalla (gana la de más prioridad). Se recalcula al mover el mapa.
  function declutter(data, size) {
    const map = H.app && H.app.mapView && H.app.mapView.map;
    if (!map) return data;
    const W = map.getCanvas().clientWidth, Hh = map.getCanvas().clientHeight;
    const kept = [], boxes = [];
    for (const d of data.slice().sort((a, b) => (b.prio || 0) - (a.prio || 0))) {
      let p;
      try { p = map.project(d.pos); } catch (e) { continue; }
      if (!p || p.x < -50 || p.y < -20 || p.x > W + 50 || p.y > Hh + 20) continue;
      const w = d.text.length * size * 0.56 + 10, h = size + 8;
      const box = [p.x - w / 2, p.y - h, p.x + w / 2, p.y + 4];
      if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      kept.push(d);
    }
    return kept;
  }
  function labelLayer(id, data, o) {
    o = o || {};
    data = declutter(data, o.size || 12);
    return new deck.TextLayer({
      id, data, getPosition: (d) => d.pos, getText: (d) => d.text, getSize: o.size || 12, sizeUnits: 'pixels',
      getColor: o.color || [240, 239, 236, 255], getPixelOffset: o.offset || [0, -16], fontFamily: FONT, fontWeight: 600,
      characterSet: 'auto', fontSettings: { sdf: true, fontSize: 56, buffer: 6 }, outlineWidth: 4, outlineColor: [7, 8, 11, 235],
      getTextAnchor: 'middle', getAlignmentBaseline: 'bottom', billboard: true, pickable: false,
    });
  }

  H.buildLayers = function (S, D) {
    const L = [];
    const f = S.dayView != null ? { d0: S.dayView, d1: S.dayView, c: -1 } : S.f;
    const st = D.stats(f);
    const mode = S.dayView != null && S.mode !== 'anim' ? 'routes' : S.mode;

    if (mode === 'routes') {
      const sv = D.segments(f, S.colorBy, S.modeMask);
      const day = S.dayView != null;
      L.push(pathLayer('paths', sv, { width: day ? Math.max(3.5, S.pathWidth + 1.5) : S.pathWidth, opacity: day ? 1 : 0.82, pickable: true }));
      if (S.showPlaces || day) {
        const pl = D.places(f).slice(0, 5000);
        const maxMin = pl.length ? pl[0].min : 1;
        L.push(new deck.ScatterplotLayer({
          id: 'places', data: pl,
          getPosition: (x) => [x.place.lo, x.place.la],
          // en metros: al alejarte los lugares se encogen y no tapan las rutas
          getRadius: (x) => (day ? 30 : 16 + 300 * Math.sqrt(x.min / Math.max(1, maxMin))),
          radiusUnits: 'meters', radiusMinPixels: day ? 5 : 1.6, radiusMaxPixels: day ? 9 : 22, stroked: true, filled: true,
          getFillColor: (x) => (x.place.type ? [255, 255, 255, 245] : [240, 239, 236, day ? 235 : 170]),
          getLineColor: (x) => (x.place.type ? [144, 133, 233, 255] : [7, 8, 11, 210]),
          lineWidthUnits: 'pixels', getLineWidth: (x) => (x.place.type ? 3 : 1.25),
          pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 255],
          updateTriggers: { getRadius: [day, maxMin] },
        }));
        const labels = [];
        if (day) {
          // paradas numeradas en el orden del itinerario (el mismo número que en el panel del día)
          for (const [pi, n] of D.dayStops(S.dayView)) {
            const p = D.ds.places[pi];
            const nm = D.placeName(pi, { plain: true });
            labels.push({ pos: [p.lo, p.la], text: n + (/^Lugar /.test(nm) ? '' : ' · ' + nm), prio: 1000 - n });
          }
        } else {
          pl.filter((x) => x.place.type).forEach((x) => labels.push({ pos: [x.place.lo, x.place.la], text: x.place.type === 'home' ? 'Casa' : 'Trabajo' }));
        }
        if (labels.length && (day || S.zoom >= 10.5)) L.push(labelLayer('place-labels', labels.slice(0, 40), { offset: [0, day ? -13 : -25], size: 12.5 }));
      }
    } else if (mode === 'heat') {
      const pv = D.points(f);
      L.push(new deck.HeatmapLayer({
        id: 'heat', data: { length: pv.n, attributes: { getPosition: { value: pv.pos, size: 2 }, getWeight: { value: pv.ws, size: 1 } } },
        radiusPixels: S.heatRadius, intensity: 1.8, threshold: 0.02, colorRange: HEAT, aggregation: 'SUM', debounceTimeout: 120,
      }));
    } else if (mode === 'hex') {
      const bins = D.hexBins(f, S.hexRadius, S.hexLat || 0);
      const ramp = H.RAMP_HEAT.slice(2);
      L.push(new deck.ColumnLayer({
        id: 'hex', data: bins, diskResolution: 6, angle: 30, radius: S.hexRadius * 0.9, extruded: true,
        getPosition: (b) => b.pos, getElevation: (b) => 0.02 + Math.pow(b.h, 2.2), elevationScale: S.hexRadius * 6,
        getFillColor: (b) => H.rampAt(ramp, b.rank).concat(235),
        material: { ambient: 0.55, diffuse: 0.6, shininess: 32, specularColor: [60, 60, 70] },
        pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 140],
        transitions: { getElevation: { duration: 700, enter: () => [0] } },
        updateTriggers: { getElevation: bins, getFillColor: bins },
      }));
    } else if (mode === 'anim') {
      const sv = D.segments(f, 'mode', S.modeMask);
      L.push(pathLayer('ghost', sv, { width: 1.2, opacity: 0.14 }));
      L.push(new deck.TripsLayer({
        id: 'trips', data: { length: sv.n, startIndices: sv.start, attributes: { getPath: { value: sv.pos, size: 2 }, getTimestamps: { value: sv.ts, size: 1 }, getColor: { value: sv.col, size: 4, normalized: true } } },
        _pathType: 'open', currentTime: S.anim.t, trailLength: S.anim.trail, fadeTrail: true,
        widthUnits: 'pixels', getWidth: 4, widthMinPixels: 2.5, capRounded: true, jointRounded: true, opacity: 1,
      }));
      if (S.anim.head) {
        const h = [S.anim.head];
        L.push(new deck.ScatterplotLayer({ id: 'head-halo', data: h, getPosition: (d) => d, getRadius: 20, radiusUnits: 'pixels', getFillColor: [144, 133, 233, 70], stroked: false, updateTriggers: { getPosition: S.anim.t } }));
        L.push(new deck.ScatterplotLayer({ id: 'head', data: h, getPosition: (d) => d, getRadius: 6.5, radiusUnits: 'pixels', getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: [144, 133, 233, 255], lineWidthUnits: 'pixels', getLineWidth: 3, updateTriggers: { getPosition: S.anim.t } }));
      }
    } else if (mode === 'trips') {
      const trips = st.trips;
      const days = (t) => t.d1 - t.d0 + 1;
      const color = (t) => (t.mode >= 0 ? H.MODES[t.mode].rgb : WHITE);
      if (S.globe) {
        // en el globo, ArcLayer no se dibuja: se usan círculos máximos pegados a la superficie
        L.push(new deck.PathLayer({
          id: 'arcs', data: trips, getPath: (t) => greatCircle(t.hlo, t.hla, t.dlo, t.dla),
          getColor: (t) => color(t).concat(230), getWidth: (t) => Math.min(8, 1.6 + Math.sqrt(days(t))), widthUnits: 'pixels',
          capRounded: true, jointRounded: true, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 235],
        }));
      } else L.push(new deck.ArcLayer({
        id: 'arcs', data: trips,
        getSourcePosition: (t) => [t.hlo, t.hla], getTargetPosition: (t) => [t.dlo, t.dla],
        getSourceColor: (t) => color(t).concat(70), getTargetColor: (t) => color(t).concat(255),
        getWidth: (t) => Math.min(9, 1.6 + Math.sqrt(days(t)) * 1.1), widthUnits: 'pixels', greatCircle: true, getHeight: 0.55,
        pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 235],
      }));
      L.push(new deck.ScatterplotLayer({
        id: 'dests', data: trips, getPosition: (t) => [t.dlo, t.dla], getRadius: (t) => Math.min(14, 3 + Math.sqrt(days(t)) * 1.6), radiusUnits: 'pixels',
        getFillColor: (t) => color(t).concat(235), stroked: true, getLineColor: [7, 8, 11, 230], lineWidthUnits: 'pixels', getLineWidth: 1.5,
        pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 255],
      }));
      const homes = new Map();
      for (const t of trips) homes.set(t.hla.toFixed(2) + t.hlo.toFixed(2), [t.hlo, t.hla]);
      L.push(new deck.ScatterplotLayer({ id: 'origin', data: Array.from(homes.values()), getPosition: (d) => d, getRadius: 7, radiusUnits: 'pixels', getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: [144, 133, 233, 255], lineWidthUnits: 'pixels', getLineWidth: 3 }));
      const seen = new Set(), labels = [];
      for (const t of trips.slice().sort((a, b) => days(b) - days(a))) {
        const name = t.ci >= 0 ? D.ds.cities[t.ci].n : H.countryName(t.c);
        if (seen.has(name)) continue;
        seen.add(name);
        labels.push({ pos: [t.dlo, t.dla], text: name, prio: days(t) });
      }
      L.push(labelLayer('trip-labels', labels.slice(0, 60), { size: 12, offset: [0, -12] }));
    } else if (mode === 'countries') {
      const by = new Map(st.countries.map((x) => [x.c, x]));
      const max = Math.max(2, ...st.countries.map((x) => x.days));
      const feats = H.countryGeo().features.filter((ft) => by.has(ft.properties.i));
      const fill = (ft) => H.rampAt(H.RAMP_BLUE.slice(2), Math.log(by.get(ft.properties.i).days) / Math.log(max)).concat(200);
      L.push(new deck.GeoJsonLayer({
        id: 'countries', data: { type: 'FeatureCollection', features: feats }, filled: true, stroked: true,
        getFillColor: fill, getLineColor: [205, 226, 251, 220], lineWidthUnits: 'pixels', getLineWidth: 1.2,
        pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 70],
        updateTriggers: { getFillColor: [max, st.countries.length, f.d0, f.d1] },
      }));
      const labels = st.countries.map((x) => ({ pos: H.COUNTRIES[x.c].center, text: H.COUNTRIES[x.c].name, prio: x.days }));
      L.push(labelLayer('country-labels', labels, { size: 12.5, offset: [0, 0] }));
    }
    return L;
  };
})();
