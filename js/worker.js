/* Huellas · importación y análisis en segundo plano.
 *
 * Todo este archivo es el cuerpo de un Web Worker: app.js lo convierte en un Blob y lo arranca, así la
 * página funciona abriendo index.html con doble clic (sin servidor) y la interfaz no se congela aunque
 * el archivo pese un giga. Lee los archivos en streaming, sin cargarlos enteros en memoria.
 *
 * Formatos: Cronología del móvil Android (Timeline.json · semanticSegments/rawSignals), exportación de
 * iPhone (array con visit/activity/timelinePath), Google Takeout antiguo (Records.json y Semantic
 * Location History), Timeline Edits.json, .zip de Takeout, GPX, KML (gx:Track y Placemark) y CSV.
 */
function HuellasWorker() {
  'use strict';

  // ------------------------------------------------------------------ constantes
  const NM = 8; // 0 coche · 1 a pie · 2 bici · 3 bus/tranvía · 4 tren/metro · 5 barco · 6 avión · 7 otros
  const CAR = 0, WALK = 1, BIKE = 2, BUS = 3, TRAIN = 4, BOAT = 5, PLANE = 6, OTHER = 7;
  const STILL = -2, UNK = -1;
  const SRC_RAW = 0, SRC_PATH = 1, SRC_VISIT = 2, SRC_ACT = 3;
  const NOOFF = -32768;
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const RAD = Math.PI / 180;

  let GEO = null;     // países y ciudades decodificados (llega con el mensaje 'init')
  let S = null;       // estado de la importación en curso
  let lastProgress = 0;

  function hav(a1, o1, a2, o2) {
    const dLa = (a2 - a1) * RAD, dLo = (o2 - o1) * RAD;
    const s = Math.sin(dLa / 2), t = Math.sin(dLo / 2);
    const h = s * s + Math.cos(a1 * RAD) * Math.cos(a2 * RAD) * t * t;
    return 12742017.6 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  const pl = (n, one, many) => n.toLocaleString('es-ES') + ' ' + (n === 1 ? one : many);

  function progress(stage, pct, msg, force) {
    const now = Date.now();
    if (!force && now - lastProgress < 80) return;
    lastProgress = now;
    self.postMessage({ type: 'progress', stage, pct: Math.max(0, Math.min(1, pct)), msg });
  }

  // ------------------------------------------------------------------ almacenamiento creciente
  function newState() {
    const cap = 1 << 16;
    return {
      cap, n: 0,
      t: new Float64Array(cap), la: new Float64Array(cap), lo: new Float64Array(cap),
      acc: new Float32Array(cap), off: new Int16Array(cap), src: new Uint8Array(cap), alt: new Float32Array(cap),
      visits: [], acts: [], profile: [],
      files: [], warnings: [],
      badTime: 0, badItems: 0,
    };
  }
  function growPoints() {
    const cap = S.cap * 2;
    for (const k of ['t', 'la', 'lo', 'acc', 'off', 'src', 'alt']) {
      const b = new S[k].constructor(cap);
      b.set(S[k]);
      S[k] = b;
    }
    S.cap = cap;
  }
  function addPoint(t, la, lo, off, acc, src, alt) {
    if (!(t > 0)) { S.badTime++; return; }
    if (S.n === S.cap) growPoints();
    const i = S.n++;
    S.t[i] = t; S.la[i] = la; S.lo[i] = lo;
    S.off[i] = off === off && off !== NOOFF && Math.abs(off) <= 900 ? off : NOOFF;
    S.acc[i] = acc; S.src[i] = src; S.alt[i] = alt;
    CUR.items++;
  }

  // ------------------------------------------------------------------ coordenadas y fechas
  let LAT = 0, LON = 0;
  function e7lat(v) { v = +v; if (v > 900000000) v -= 4294967296; return v / 1e7; }
  function e7lon(v) { v = +v; if (v > 1800000000) v -= 4294967296; return v / 1e7; }

  function ll(v) {
    if (v == null) return false;
    let la, lo;
    if (typeof v === 'string') {
      let s = v.trim();
      if (s.startsWith('geo:')) s = s.slice(4);
      const k = s.indexOf(',');
      if (k < 0) return false;
      la = parseFloat(s.slice(0, k));
      lo = parseFloat(s.slice(k + 1));
    } else if (Array.isArray(v)) {
      if (v.length < 2) return false;
      la = +v[0]; lo = +v[1];
    } else if (typeof v === 'object') {
      if (v.latitudeE7 != null) { la = e7lat(v.latitudeE7); lo = e7lon(v.longitudeE7); }
      else if (v.latE7 != null) { la = e7lat(v.latE7); lo = e7lon(v.lngE7 != null ? v.lngE7 : v.lonE7); }
      else if (v.latLng != null) return ll(v.latLng);
      else if (v.LatLng != null) return ll(v.LatLng);
      else if (v.point != null) return ll(v.point);
      else if (v.lat != null) { la = +v.lat; lo = +(v.lng != null ? v.lng : v.lon != null ? v.lon : v.long); }
      else if (v.latitude != null) { la = +v.latitude; lo = +v.longitude; }
      else if (v.location != null) return ll(v.location);
      else return false;
    } else return false;
    if (!(la >= -90 && la <= 90 && lo >= -180 && lo <= 180)) return false;
    if (la === 0 && lo === 0) return false;
    LAT = la; LON = lo;
    return true;
  }

  let OFF = NOOFF; // desfase horario (min) del último instante leído, si venía en el texto
  function tm(v) {
    OFF = NOOFF;
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
    const s = String(v).trim();
    const c0 = s.charCodeAt(0);
    if (c0 >= 48 && c0 <= 57 && s.length >= 9 && /^\d+(\.\d+)?$/.test(s)) {
      const n = +s;
      return n < 1e11 ? n * 1000 : n;
    }
    const ms = Date.parse(s);
    const L = s.length;
    const z = s.charCodeAt(L - 1);
    if (z !== 90 && z !== 122 && L > 10) {
      let sg = s.charCodeAt(L - 6);
      if ((sg === 43 || sg === 45) && s.charCodeAt(L - 3) === 58) {
        OFF = ((s.charCodeAt(L - 5) - 48) * 10 + (s.charCodeAt(L - 4) - 48)) * 60 + (s.charCodeAt(L - 2) - 48) * 10 + (s.charCodeAt(L - 1) - 48);
        if (sg === 45) OFF = -OFF;
      } else {
        sg = s.charCodeAt(L - 5);
        if ((sg === 43 || sg === 45) && s.charCodeAt(L - 8) === 58) {
          OFF = ((s.charCodeAt(L - 4) - 48) * 10 + (s.charCodeAt(L - 3) - 48)) * 60 + (s.charCodeAt(L - 2) - 48) * 10 + (s.charCodeAt(L - 1) - 48);
          if (sg === 45) OFF = -OFF;
        }
      }
      if (!(OFF >= -900 && OFF <= 900)) OFF = NOOFF;
    }
    return ms;
  }

  function modeOf(raw) {
    let s = String(raw == null ? '' : raw).toUpperCase().trim().replace(/[\s-]+/g, '_');
    if (s.startsWith('IN_')) s = s.slice(3);
    if (s.startsWith('ON_')) s = s.slice(3);
    switch (s) {
      case 'PASSENGER_VEHICLE': case 'VEHICLE': case 'CAR': case 'DRIVING': case 'DRIVE': case 'TAXI':
      case 'MOTORCYCLING': case 'MOTORCYCLE': case 'ROAD_VEHICLE': case 'FOUR_WHEEL_VEHICLE': case 'TWO_WHEEL_VEHICLE':
      case 'AUTOMOBILE': case 'CAR_PASSENGER':
        return CAR;
      case 'WALKING': case 'WALK': case 'FOOT': case 'RUNNING': case 'RUN': case 'HIKING': case 'JOGGING':
      case 'PEDESTRIAN':
        return WALK;
      case 'CYCLING': case 'BICYCLE': case 'BIKING': case 'BIKE': case 'CYCLE': case 'MOUNTAIN_BIKING':
      case 'E_BIKE': case 'SCOOTER': case 'E_SCOOTER': case 'KICK_SCOOTER':
        return BIKE;
      case 'BUS': case 'TRAM': case 'TRAMWAY': case 'STREETCAR': case 'CABLECAR': case 'CABLE_CAR': case 'FUNICULAR':
      case 'GONDOLA_LIFT': case 'TROLLEYBUS': case 'COACH':
        return BUS;
      case 'TRAIN': case 'SUBWAY': case 'METRO': case 'RAIL': case 'HIGH_SPEED_TRAIN': case 'HEAVY_RAIL':
      case 'LIGHT_RAIL': case 'COMMUTER_TRAIN': case 'RAILWAY': case 'MONORAIL': case 'UNDERGROUND':
        return TRAIN;
      case 'FERRY': case 'BOAT': case 'SAILING': case 'BOATING': case 'KAYAKING': case 'ROWING': case 'CRUISE':
      case 'SHIP': case 'CANOEING': case 'PADDLING':
        return BOAT;
      case 'FLYING': case 'PLANE': case 'AIRPLANE': case 'FLIGHT': case 'AIRCRAFT': case 'AIR':
        return PLANE;
      case 'STILL': case 'STATIONARY': case 'TILTING':
        return STILL;
      case '': case 'UNKNOWN': case 'UNKNOWN_ACTIVITY_TYPE': case 'UNKNOWN_ACTIVITY': case 'UNCATEGORIZED':
        return UNK;
      default:
        return s.includes('UNKNOWN') ? UNK : OTHER;
    }
  }

  function placeType(s) {
    s = String(s == null ? '' : s).toUpperCase();
    if (s.includes('HOME')) return 'home';
    if (s.includes('WORK')) return 'work';
    return '';
  }

  function addVisit(s, e, la, lo, off, pid, st, name, addr, lvl) {
    if (!(s > 0)) return;
    if (!(e >= s)) e = s;
    addPoint(s, la, lo, off, NaN, SRC_VISIT, NaN);
    if (e > s) addPoint(e, la, lo, off, NaN, SRC_VISIT, NaN);
    if (lvl > 0) return; // las sub-visitas (una tienda dentro de un centro comercial) duplicarían el tiempo
    S.visits.push({ s, e, la, lo, off, pid: pid ? String(pid) : '', st: placeType(st), name: name ? String(name) : '', addr: addr ? String(addr) : '' });
  }

  function addAct(s, e, la1, lo1, la2, lo2, dist, rawMode, off) {
    if (!(s > 0)) return;
    if (!(e >= s)) e = s;
    addPoint(s, la1, lo1, off, NaN, SRC_ACT, NaN);
    if (e > s) addPoint(e, la2, lo2, off, NaN, SRC_ACT, NaN);
    let mode = modeOf(rawMode);
    let inferred = false;
    const straight = hav(la1, lo1, la2, lo2);
    let d = dist > 0 && dist < 3e7 ? dist : NaN;
    if (mode === UNK || mode === STILL) {
      const ref = d === d ? d : straight * 1.2;
      const v = ref / Math.max(60, (e - s) / 1000);
      if (ref < 80) mode = STILL;
      else { mode = v < 2.3 ? WALK : v < 60 ? CAR : PLANE; inferred = true; }
    }
    if (!(d === d)) d = mode === PLANE ? straight : straight * 1.2;
    S.acts.push({ s, e, la1, lo1, la2, lo2, d, mode, inferred, off });
  }

  // ------------------------------------------------------------------ manejadores por formato
  let CUR = null; // archivo en curso: { name, kinds:Set, items, ... }

  function num(v) { return v == null || v === '' ? NaN : +v; }

  function onSegment(o) { // Android (semanticSegments) e iPhone (array raíz): misma forma, distintos tipos
    const s = tm(o.startTime); let off0 = OFF;
    const e = tm(o.endTime); let off1 = OFF;
    if (o.startTimeTimezoneUtcOffsetMinutes != null) off0 = +o.startTimeTimezoneUtcOffsetMinutes;
    if (o.endTimeTimezoneUtcOffsetMinutes != null) off1 = +o.endTimeTimezoneUtcOffsetMinutes;
    if (off1 === NOOFF) off1 = off0;
    const tp = o.timelinePath;
    if (Array.isArray(tp)) {
      for (let k = 0; k < tp.length; k++) {
        const p = tp[k];
        if (!p) continue;
        let t, off = off0;
        if (p.time != null) { t = tm(p.time); if (OFF !== NOOFF) off = OFF; }
        else if (p.durationMinutesOffsetFromStartTime != null) t = s + MIN * num(p.durationMinutesOffsetFromStartTime);
        else continue;
        if (ll(p.point != null ? p.point : p)) addPoint(t, LAT, LON, off, NaN, SRC_PATH, NaN);
      }
    }
    const v = o.visit;
    if (v) {
      const c = v.topCandidate || v.candidate || v;
      if (ll(c.placeLocation != null ? c.placeLocation : c.location != null ? c.location : c.point)) {
        addVisit(s, e, LAT, LON, off0, c.placeId || c.placeID || c.place_id || '', c.semanticType || c.type || '',
          c.name || '', c.address || '', num(v.hierarchyLevel) || 0);
      }
    }
    const a = o.activity;
    if (a) {
      const ok1 = ll(a.start != null ? a.start : a.startLocation); const la1 = LAT, lo1 = LON;
      const ok2 = ll(a.end != null ? a.end : a.endLocation); const la2 = LAT, lo2 = LON;
      if (ok1 || ok2) {
        const tc = a.topCandidate || {};
        addAct(s, e, ok1 ? la1 : la2, ok1 ? lo1 : lo2, ok2 ? la2 : la1, ok2 ? lo2 : lo1,
          num(a.distanceMeters != null ? a.distanceMeters : a.distance), tc.type || a.type || a.activityType || '', off0);
      }
    }
    if (tp || v || a || o.timelineMemory) CUR.kinds.add('seg');
  }

  function onRaw(o) {
    const p = o.position;
    if (!p) return;
    CUR.kinds.add('raw');
    if (!ll(p.LatLng != null ? p.LatLng : p.latLng != null ? p.latLng : p.point != null ? p.point : p)) return;
    const la = LAT, lo = LON;
    const t = tm(p.timestamp != null ? p.timestamp : o.timestamp);
    addPoint(t, la, lo, OFF, num(p.accuracyMeters), SRC_RAW, num(p.altitudeMeters));
  }

  function onRecord(o) {
    if (!ll(o)) return;
    const la = LAT, lo = LON;
    const t = tm(o.timestamp != null ? o.timestamp : o.timestampMs != null ? o.timestampMs : o.timestampMS != null ? o.timestampMS : o.time);
    addPoint(t, la, lo, OFF, num(o.accuracy), SRC_RAW, num(o.altitude));
    CUR.kinds.add('records');
  }

  function rawPath(points, off) {
    if (!Array.isArray(points)) return;
    for (const p of points) {
      if (!p || !ll(p)) continue;
      const la = LAT, lo = LON;
      const t = tm(p.timestamp != null ? p.timestamp : p.timestampMs);
      if (t > 0) addPoint(t, la, lo, OFF !== NOOFF ? OFF : off, num(p.accuracyMeters), SRC_PATH, NaN);
    }
  }

  function duration(d) {
    d = d || {};
    const s = tm(d.startTimestamp != null ? d.startTimestamp : d.startTimestampMs);
    const off = OFF;
    const e = tm(d.endTimestamp != null ? d.endTimestamp : d.endTimestampMs);
    return [s, e, off];
  }

  function onSemantic(o) {
    const pv = o.placeVisit;
    if (pv) {
      CUR.kinds.add('semantic');
      const loc = pv.location || {};
      const [s, e, off] = duration(pv.duration);
      if (ll(loc) || ll({ latitudeE7: pv.centerLatE7, longitudeE7: pv.centerLngE7 })) {
        addVisit(s, e, LAT, LON, off, loc.placeId || '', loc.semanticType || '', loc.name || '', loc.address || '', 0);
      }
      if (pv.simplifiedRawPath) rawPath(pv.simplifiedRawPath.points, off);
    }
    const as = o.activitySegment;
    if (as) {
      CUR.kinds.add('semantic');
      const [s, e, off] = duration(as.duration);
      const ok1 = ll(as.startLocation); const la1 = LAT, lo1 = LON;
      const ok2 = ll(as.endLocation); const la2 = LAT, lo2 = LON;
      let type = as.activityType;
      if (!type && Array.isArray(as.activities) && as.activities[0]) type = as.activities[0].activityType;
      const dist = num(as.distance != null ? as.distance : as.waypointPath && as.waypointPath.distanceMeters);
      if (ok1 || ok2) {
        addAct(s, e, ok1 ? la1 : la2, ok1 ? lo1 : lo2, ok2 ? la2 : la1, ok2 ? lo2 : lo1, dist, type || '', off);
      }
      if (as.simplifiedRawPath) rawPath(as.simplifiedRawPath.points, off);
      const wp = as.waypointPath && as.waypointPath.waypoints;
      if (Array.isArray(wp) && wp.length && s > 0 && e > s) {
        // Los waypoints no traen hora: se reparten en el tramo según la distancia recorrida.
        const pts = [];
        if (ok1) pts.push([la1, lo1]);
        for (const w of wp) if (ll(w)) pts.push([LAT, LON]);
        if (ok2) pts.push([la2, lo2]);
        let total = 0;
        const cum = [0];
        for (let k = 1; k < pts.length; k++) { total += hav(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]); cum.push(total); }
        for (let k = 1; k < pts.length - 1; k++) {
          const f = total > 0 ? cum[k] / total : k / (pts.length - 1);
          addPoint(s + (e - s) * f, pts[k][0], pts[k][1], off, NaN, SRC_PATH, NaN);
        }
      }
    }
  }

  function onEdit(o) {
    const sig = o.rawSignal && o.rawSignal.signal;
    const pos = sig && (sig.position || sig.location);
    if (pos) {
      CUR.kinds.add('edits');
      if (ll(pos.point != null ? pos.point : pos)) {
        const la = LAT, lo = LON;
        const t = tm(pos.timestamp != null ? pos.timestamp : sig.timestamp);
        addPoint(t, la, lo, OFF, num(pos.accuracyMm) / 1000, SRC_RAW, num(pos.altitudeMeters));
      }
    }
  }

  function onProfile(o) {
    const fp = o.frequentPlaces;
    if (Array.isArray(fp)) {
      CUR.kinds.add('profile');
      for (const f of fp) {
        if (f && ll(f.placeLocation != null ? f.placeLocation : f.location)) {
          S.profile.push({ pid: f.placeId || '', la: LAT, lo: LON, type: placeType(f.label) });
        }
      }
    }
  }

  const TIME_KEYS = ['time', 'timestamp', 'timestampMs', 'datetime', 'date', 'dateTime', 'ts', 't', 'recordedAt', 'tst'];
  function onGeneric(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    let la, lo;
    if (ll(o)) { la = LAT; lo = LON; }
    else if (o.lat == null && o.latitude == null && o.coords && ll(o.coords)) { la = LAT; lo = LON; }
    else return;
    for (const k of TIME_KEYS) {
      if (o[k] != null) {
        const t = tm(o[k]);
        if (t > 0) { addPoint(t, la, lo, OFF, num(o.accuracy != null ? o.accuracy : o.acc), SRC_RAW, num(o.altitude != null ? o.altitude : o.alt)); CUR.kinds.add('generic'); }
        return;
      }
    }
  }

  function onItem(txt, key) {
    let o;
    try { o = JSON.parse(txt); } catch (err) { S.badItems++; CUR.bad++; return; }
    if (!o || typeof o !== 'object') return;
    CUR.parsed++;
    if (key === 'userLocationProfile') return onProfile(o);
    if (Array.isArray(o)) { for (const x of o) if (x && typeof x === 'object') dispatch(x); return; }
    dispatch(o);
  }
  function dispatch(o) {
    // Records.json trae su propio campo "activity" (un array): se mira antes que los segmentos
    if (o.latitudeE7 != null || o.latE7 != null) return onRecord(o);
    if (o.startTime != null || o.visit || (o.activity && !Array.isArray(o.activity)) || o.timelinePath) return onSegment(o);
    if (o.placeVisit || o.activitySegment) return onSemantic(o);
    if (o.position || o.wifiScan || o.activityRecord) return onRaw(o);
    if (o.rawSignal || o.placeAggregates || o.deviceId != null) return onEdit(o);
    if (o.frequentPlaces) return onProfile(o);
    return onGeneric(o);
  }

  // ------------------------------------------------------------------ JSON en streaming
  // Divide el texto en los elementos de los arrays de primer nivel ({"locations":[…]}, [ … ]) sin crear
  // nunca un string con el archivo entero (Chrome no admite strings de más de ~512 MB).
  const KNOWN_KEYS = new Set(['semanticSegments', 'rawSignals', 'userLocationProfile', 'locations', 'timelineObjects', 'timelineEdits']);
  function jsonSplitter() {
    let depth = 0, root = 0, inStr = false, esc = false;
    let key = null, keyStart = -1, keyCarry = '', expectKey = false, d2Array = false;
    let cap = false, capStart = 0, capCarry = '', capDepth = 0;
    const st = { knownKey: false, keys: [], depth: () => depth, root: () => root };
    function begin(i, d) { cap = true; capDepth = d; capStart = i; capCarry = ''; }
    st.feed = function (chunk) {
      const n = chunk.length;
      let i = 0;
      if (cap) capStart = 0;
      if (keyStart >= 0) keyStart = 0;
      if (inStr && esc) { esc = false; i = 1; }
      while (i < n) {
        if (inStr) {
          const j = chunk.indexOf('"', i);
          if (j < 0) {
            let k = n - 1, bs = 0;
            while (k >= i && chunk.charCodeAt(k) === 92) { bs++; k--; }
            esc = (bs & 1) === 1;
            break;
          }
          let k = j - 1, bs = 0;
          while (k >= i && chunk.charCodeAt(k) === 92) { bs++; k--; }
          if (bs & 1) { i = j + 1; continue; }
          inStr = false;
          if (keyStart >= 0) {
            const raw = keyCarry + chunk.slice(keyStart, j);
            keyStart = -1; keyCarry = '';
            try { key = JSON.parse('"' + raw + '"'); } catch (e) { key = raw; }
            if (KNOWN_KEYS.has(key)) st.knownKey = true;
            if (st.keys.length < 50) st.keys.push(key);
          }
          i = j + 1;
          continue;
        }
        const c = chunk.charCodeAt(i);
        if (c === 34) {
          inStr = true;
          if (root === 1 && depth === 1 && expectKey) keyStart = i + 1;
        } else if (c === 123 || c === 91) {
          depth++;
          if (depth === 1) { root = c === 123 ? 1 : 2; expectKey = root === 1; }
          else if (!cap) {
            if (root === 2) { if (depth === 2) begin(i, 2); }
            else if (depth === 2) { if (c === 91) d2Array = true; else { d2Array = false; begin(i, 2); } }
            else if (depth === 3 && d2Array) begin(i, 3);
          }
        } else if (c === 125 || c === 93) {
          if (cap && depth === capDepth) {
            const txt = capCarry ? capCarry + chunk.slice(capStart, i + 1) : chunk.slice(capStart, i + 1);
            cap = false; capCarry = '';
            onItem(txt, root === 2 ? null : key);
          }
          depth--;
          if (depth === 1 && root === 1) d2Array = false;
        } else if (depth === 1 && root === 1) {
          if (c === 58) expectKey = false;
          else if (c === 44) expectKey = true;
        }
        i++;
      }
      if (cap) capCarry += chunk.slice(capStart);
      if (keyStart >= 0) keyCarry += chunk.slice(keyStart);
    };
    st.truncated = () => depth !== 0 || cap;
    return st;
  }

  // ------------------------------------------------------------------ GPX / KML / CSV en streaming
  const reAttrLat = /\blat\s*=\s*["']([^"']+)["']/, reAttrLon = /\blon\s*=\s*["']([^"']+)["']/;
  const reTime = /<time>\s*([^<]+?)\s*<\/time>/, reEle = /<ele>\s*([^<]+?)\s*<\/ele>/;
  // Posición justo después del último cierre de cualquiera de las etiquetas dadas (-1 si no hay ninguno).
  function lastClose(buf, tags) {
    let cut = -1;
    for (const tag of tags) { const i = buf.lastIndexOf(tag); if (i >= 0) cut = Math.max(cut, i + tag.length); }
    return cut;
  }

  function gpxProcessor() {
    let buf = '';
    const re = /<(trkpt|rtept|wpt)\b([^>]*?)>([\s\S]*?)<\/\1>/g;
    function run(text) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const a = reAttrLat.exec(m[2]), b = reAttrLon.exec(m[2]);
        if (!a || !b) continue;
        const la = +a[1], lo = +b[1];
        if (!ll([la, lo])) continue;
        const body = m[3] || '';
        const tt = reTime.exec(body);
        if (!tt) continue;
        const t = tm(tt[1]);
        const el = reEle.exec(body);
        if (m[1] === 'wpt') addVisit(t, t, la, lo, OFF, '', '', (/<name>\s*([^<]*?)\s*<\/name>/.exec(body) || [])[1] || '', '', 0);
        else addPoint(t, la, lo, OFF, NaN, SRC_RAW, el ? +el[1] : NaN);
        CUR.kinds.add('gpx');
      }
    }
    return {
      feed(chunk) {
        buf += chunk;
        if (buf.length < 1 << 20) return;
        const cut = lastClose(buf, ['</trkpt>', '</rtept>', '</wpt>']);
        if (cut < 0) { if (buf.length > 64 << 20) throw new Error('GPX sin puntos legibles'); return; }
        run(buf.slice(0, cut));
        buf = buf.slice(cut);
      },
      end() { run(buf); buf = ''; },
    };
  }

  function kmlProcessor() {
    let buf = '', trackMode = false;
    const whens = [], coords = [];
    const reTok = /<when>\s*([^<]+?)\s*<\/when>|<gx:coord>\s*([^<]+?)\s*<\/gx:coord>|<\/gx:Track>/g;
    const rePm = /<Placemark\b[\s\S]*?<\/Placemark>/g;
    function flushPairs() {
      while (whens.length && coords.length) {
        const t = whens.shift(), c = coords.shift();
        const p = c.split(/\s+/);
        const lo = +p[0], la = +p[1];
        if (ll([la, lo])) { addPoint(tm(t), la, lo, OFF, NaN, SRC_RAW, p[2] != null ? +p[2] : NaN); CUR.kinds.add('kml'); }
      }
    }
    function tokens(text) {
      reTok.lastIndex = 0;
      let m;
      while ((m = reTok.exec(text))) {
        if (m[1] != null) whens.push(m[1]);
        else if (m[2] != null) coords.push(m[2]);
        else { flushPairs(); whens.length = 0; coords.length = 0; }
        if (whens.length > 4096 && coords.length) flushPairs();
      }
      flushPairs();
    }
    function placemarks(text) {
      rePm.lastIndex = 0;
      let m;
      while ((m = rePm.exec(text))) {
        const pm = m[0];
        const name = (/<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/.exec(pm) || [])[1] || '';
        const begin = (/<begin>\s*([^<]+?)\s*<\/begin>/.exec(pm) || [])[1];
        const endT = (/<end>\s*([^<]+?)\s*<\/end>/.exec(pm) || [])[1];
        const when = (/<when>\s*([^<]+?)\s*<\/when>/.exec(pm) || [])[1];
        const cat = (/<Data name="Category">\s*<value>\s*([^<]*?)\s*<\/value>/i.exec(pm) || [])[1];
        const s = tm(begin || when), so = OFF;
        const e = endT ? tm(endT) : s;
        const pt = /<Point>[\s\S]*?<coordinates>\s*([^<]+?)\s*<\/coordinates>/.exec(pm);
        const ls = /<LineString>[\s\S]*?<coordinates>\s*([^<]+?)\s*<\/coordinates>/.exec(pm);
        if (pt && s > 0) {
          const p = pt[1].split(',');
          if (ll([+p[1], +p[0]])) { addVisit(s, e, LAT, LON, so, '', '', name.replace(/<[^>]+>/g, ''), '', 0); CUR.kinds.add('kml'); }
        } else if (ls && s > 0) {
          const pts = ls[1].trim().split(/\s+/).map((q) => q.split(',')).filter((q) => ll([+q[1], +q[0]])).map((q) => [+q[1], +q[0]]);
          if (pts.length >= 2) {
            addAct(s, e, pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1], NaN, cat || '', so);
            for (let k = 1; k < pts.length - 1; k++) addPoint(s + (e - s) * (k / (pts.length - 1)), pts[k][0], pts[k][1], so, NaN, SRC_PATH, NaN);
            CUR.kinds.add('kml');
          }
        }
      }
    }
    return {
      feed(chunk) {
        buf += chunk;
        if (!trackMode && buf.indexOf('<gx:Track') >= 0) trackMode = true;
        if (buf.length < 1 << 20) return;
        const cut = trackMode ? lastClose(buf, ['</when>', '</gx:coord>', '</gx:Track>']) : lastClose(buf, ['</Placemark>']);
        if (cut < 0) { if (buf.length > 64 << 20) throw new Error('KML sin datos legibles'); return; }
        const head = buf.slice(0, cut);
        buf = buf.slice(cut);
        if (trackMode) tokens(head); else placemarks(head);
      },
      end() { if (trackMode) tokens(buf); else placemarks(buf); buf = ''; },
    };
  }

  function csvProcessor() {
    let carry = '', header = null, delim = ',', iLa = -1, iLo = -1, iT = -1, iAcc = -1, iAlt = -1, lines = 0;
    function cells(line) {
      if (line.indexOf('"') < 0) return line.split(delim);
      const out = []; let cur = '', q = false;
      for (let k = 0; k < line.length; k++) {
        const ch = line[k];
        if (ch === '"') { if (q && line[k + 1] === '"') { cur += '"'; k++; } else q = !q; }
        else if (ch === delim && !q) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    }
    function line(l) {
      if (!l.trim()) return;
      if (!header) {
        delim = (l.match(/;/g) || []).length > (l.match(/,/g) || []).length ? ';' : l.indexOf('\t') >= 0 && l.indexOf(',') < 0 ? '\t' : ',';
        header = cells(l).map((h) => h.trim().replace(/^﻿/, '').toLowerCase());
        header.forEach((h, k) => {
          if (iLa < 0 && /^(lat|latitude|latitud|latitudee7)$/.test(h)) iLa = k;
          else if (iLo < 0 && /^(lon|lng|long|longitude|longitud|longitudee7)$/.test(h)) iLo = k;
          else if (iT < 0 && /^(time|timestamp|date|datetime|date_time|fecha|fecha_hora|utc|time_utc|start_time|starttime|recorded_at|timestampms)$/.test(h)) iT = k;
          else if (iAcc < 0 && /^(accuracy|acc|precision|precisión|hdop)$/.test(h)) iAcc = k;
          else if (iAlt < 0 && /^(altitude|alt|ele|elevation|altitud)$/.test(h)) iAlt = k;
        });
        if (iLa < 0 || iLo < 0 || iT < 0) throw new Error('CSV sin columnas de latitud, longitud y fecha');
        return;
      }
      const c = cells(l);
      let la = +c[iLa], lo = +c[iLo];
      if (Math.abs(la) > 90) la = la / 1e7;
      if (Math.abs(lo) > 180) lo = lo / 1e7;
      if (!ll([la, lo])) return;
      const t = tm(c[iT]);
      addPoint(t, la, lo, OFF, iAcc >= 0 ? +c[iAcc] : NaN, SRC_RAW, iAlt >= 0 ? +c[iAlt] : NaN);
      CUR.kinds.add('csv');
      lines++;
    }
    return {
      feed(chunk) {
        const text = carry + chunk;
        const parts = text.split(/\r?\n/);
        carry = parts.pop();
        for (const p of parts) line(p);
      },
      end() { if (carry) line(carry); carry = ''; },
    };
  }

  // ------------------------------------------------------------------ lectura de ficheros y ZIP
  // Texto por bloques grandes: de un File se leen trozos de 8 MB con slice() (mucho más rápido que
  // file.stream(), que entrega trocitos de 64 KB); de un zip, el stream ya descomprimido.
  async function* fileChunks(file, name, base) {
    const CH = 8 << 20;
    const dec = new TextDecoder('utf-8');
    for (let o = 0; o < file.size; o += CH) {
      const buf = await file.slice(o, Math.min(file.size, o + CH)).arrayBuffer();
      CUR.bytes += buf.byteLength;
      progress('read', (base + CUR.bytes) / S.totalBytes, 'Leyendo ' + name);
      yield dec.decode(buf, { stream: o + CH < file.size });
    }
    const tail = dec.decode();
    if (tail) yield tail;
  }
  async function* streamChunks(byteStream, name, sizeHint, base) {
    const counter = new TransformStream({
      transform(chunk, ctl) {
        CUR.bytes += chunk.byteLength;
        progress('read', (base + Math.min(CUR.bytes, sizeHint)) / S.totalBytes, 'Leyendo ' + name);
        ctl.enqueue(chunk);
      },
    });
    const reader = byteStream.pipeThrough(counter).pipeThrough(new TextDecoderStream()).getReader();
    let pending = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        pending += value;
        if (pending.length >= 4 << 20) { yield pending; pending = ''; }
      }
      if (pending) yield pending;
    } finally {
      try { await reader.cancel(); } catch (e) { /* ya cerrado */ }
    }
  }

  async function readText(chunks, name) {
    let proc = null, kind = '', seen = 0, first = '';
    {
      for await (const value of chunks) {
        if (!value) continue;
        if (!proc) {
          first += value;
          const lead = first.replace(/^[﻿\s]+/, '');
          if (lead.length < 1 && first.length < 4096) continue;
          const ch = lead[0];
          const lower = name.toLowerCase();
          const sample = lead.slice(0, 4096);
          if (/\u0000/.test(sample) || (sample.match(/\uFFFD/g) || []).length > sample.length * 0.02) {
            throw new Error('No es un archivo de texto (¿una imagen o un archivo comprimido?). Exporta la Cronología en JSON');
          }
          if (ch === '{' || ch === '[') { kind = 'json'; proc = jsonSplitter(); }
          else if (ch === '<') {
            const head = lead.slice(0, 4096).toLowerCase();
            if (head.indexOf('<gpx') >= 0 || lower.endsWith('.gpx')) { kind = 'gpx'; proc = gpxProcessor(); }
            else if (head.indexOf('<kml') >= 0 || lower.endsWith('.kml')) { kind = 'kml'; proc = kmlProcessor(); }
            else if (lead.length < 4096) continue;
            else throw new Error('Documento XML que no es GPX ni KML');
          } else if (/[,;\t]/.test(lead.split(/\r?\n/)[0] || '')) { kind = 'csv'; proc = csvProcessor(); }
          else throw new Error('No parece un archivo de ubicaciones (JSON, GPX, KML o CSV)');
          CUR.format = kind;
          proc.feed(first);
          seen += first.length;
          first = '';
        } else {
          proc.feed(value);
          seen += value.length;
        }
        // Si es un JSON enorme sin nada reconocible (otro producto de Takeout), no lo leemos entero.
        if (kind === 'json' && seen > (8 << 20) && !proc.knownKey && CUR.items === 0 && S.visits.length === CUR.v0) {
          CUR.skipped = true;
          break;
        }
      }
      if (!proc && first.trim()) {
        throw new Error('No parece un archivo de ubicaciones (JSON, GPX, KML o CSV)');
      }
      if (proc && proc.end) proc.end();
      if (kind === 'json' && proc.truncated() && !CUR.skipped) CUR.truncated = true;
    }
  }

  async function zipEntries(file) {
    const size = file.size;
    const tailLen = Math.min(size, 65557 + 20);
    const tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('El .zip está dañado o incompleto');
    let count = tail.getUint16(eocd + 10, true);
    let cdSize = tail.getUint32(eocd + 12, true);
    let cdOff = tail.getUint32(eocd + 16, true);
    if ((cdOff === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) && eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
      const z64 = Number(tail.getBigUint64(eocd - 20 + 8, true));
      const rec = new DataView(await file.slice(z64, z64 + 56).arrayBuffer());
      if (rec.getUint32(0, true) === 0x06064b50) {
        count = Number(rec.getBigUint64(32, true));
        cdSize = Number(rec.getBigUint64(40, true));
        cdOff = Number(rec.getBigUint64(48, true));
      }
    }
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const out = [];
    let p = 0;
    for (let k = 0; k < count && p + 46 <= cd.byteLength; k++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const flags = cd.getUint16(p + 8, true), method = cd.getUint16(p + 10, true);
      let comp = cd.getUint32(p + 20, true), unc = cd.getUint32(p + 24, true);
      const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
      let loc = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
      let x = p + 46 + nl;
      const xe = x + xl;
      while (x + 4 <= xe) {
        const id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true);
        if (id === 1) {
          let q = x + 4;
          if (unc === 0xffffffff) { unc = Number(cd.getBigUint64(q, true)); q += 8; }
          if (comp === 0xffffffff) { comp = Number(cd.getBigUint64(q, true)); q += 8; }
          if (loc === 0xffffffff) { loc = Number(cd.getBigUint64(q, true)); }
        }
        x += 4 + len;
      }
      out.push({ name, method, comp, unc, loc, encrypted: (flags & 1) === 1, dir: name.endsWith('/') });
      p += 46 + nl + xl + cl;
    }
    return out;
  }

  async function zipEntryStream(file, ent) {
    const h = new DataView(await file.slice(ent.loc, ent.loc + 30).arrayBuffer());
    if (h.getUint32(0, true) !== 0x04034b50) throw new Error('Entrada del zip dañada: ' + ent.name);
    const start = ent.loc + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const s = file.slice(start, start + ent.comp).stream();
    if (ent.method === 0) return s;
    if (ent.method === 8) return s.pipeThrough(new DecompressionStream('deflate-raw'));
    throw new Error('Compresión no soportada en ' + ent.name + ' (usa un zip normal)');
  }

  const LOCATION_HINT = /(location|ubicaci|timeline|cronolog|semantic|records|standort|localisation|posizion|localiza)/i;
  const SKIP_NAME = /(^|\/)(settings|configuraci[oó]n|ajustes)\.json$/i;

  function fileRecord(name, size) {
    CUR = { name, size, kinds: new Set(), items: 0, parsed: 0, bad: 0, bytes: 0, v0: S.visits.length, format: '', error: '' };
    return CUR;
  }
  function closeRecord(rec) {
    S.files.push({
      name: rec.name, size: rec.size, format: rec.format, kinds: Array.from(rec.kinds), items: rec.items,
      error: rec.error, skipped: !!rec.skipped, truncated: !!rec.truncated, bad: rec.bad,
    });
  }

  async function importFile(file, base) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      let ents;
      try { ents = await zipEntries(file); }
      catch (err) { closeRecord(Object.assign(fileRecord(file.name, file.size), { error: err.message })); return; }
      const wanted = ents.filter((e) => !e.dir && /\.(json|kml|gpx|csv)$/i.test(e.name) && !SKIP_NAME.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name));
      wanted.sort((a, b) => (LOCATION_HINT.test(b.name) ? 1 : 0) - (LOCATION_HINT.test(a.name) ? 1 : 0));
      if (!wanted.length) { closeRecord(Object.assign(fileRecord(file.name, file.size), { error: 'El .zip no contiene archivos JSON, KML, GPX ni CSV' })); return; }
      const totalComp = wanted.reduce((a, e) => a + e.comp, 0) || 1;
      let done = 0;
      for (const ent of wanted) {
        const rec = fileRecord(file.name + ' › ' + ent.name.split('/').slice(-2).join('/'), ent.unc);
        const scaled = (ent.comp / totalComp) * file.size;
        try {
          if (ent.encrypted) throw new Error('El zip está protegido con contraseña');
          await readText(streamChunks(await zipEntryStream(file, ent), ent.name.split('/').pop(), scaled, base + (done / totalComp) * file.size), ent.name);
        } catch (err) { rec.error = err.message || String(err); }
        done += ent.comp;
        if (rec.items > 0 || (rec.error && LOCATION_HINT.test(ent.name))) closeRecord(rec);
      }
      return;
    }
    const rec = fileRecord(file.name, file.size);
    try { await readText(fileChunks(file, file.name, base), file.name); }
    catch (err) { rec.error = err.message || String(err); }
    closeRecord(rec);
  }

  // ------------------------------------------------------------------ geografía: países, ciudades, husos
  function decodeGeo(countries, cities) {
    const C = countries.map((c) => {
      const polys = c.p.map((rings) => rings.map((str) => {
        const v = str.split(',');
        const out = new Float64Array(v.length);
        let x = 0, y = 0;
        for (let i = 0; i < v.length; i += 2) { x += +v[i]; y += +v[i + 1]; out[i] = x / 1000; out[i + 1] = y / 1000; }
        return out;
      }));
      const bb = polys.map((rings) => {
        const r = rings[0];
        let a = 180, b = 90, c2 = -180, d = -90;
        for (let i = 0; i < r.length; i += 2) { if (r[i] < a) a = r[i]; if (r[i] > c2) c2 = r[i]; if (r[i + 1] < b) b = r[i + 1]; if (r[i + 1] > d) d = r[i + 1]; }
        return [a, b, c2, d];
      });
      let A = 180, B = 90, Cc = -180, D = -90;
      for (const q of bb) { A = Math.min(A, q[0]); B = Math.min(B, q[1]); Cc = Math.max(Cc, q[2]); D = Math.max(D, q[3]); }
      return { iso: c.iso, polys, bb, box: [A, B, Cc, D] };
    });
    const rows = cities.rows.split(';');
    const n = rows.length;
    const name = new Array(n), cc = new Array(n);
    const la = new Float32Array(n), lo = new Float32Array(n), pop = new Int32Array(n), tz = new Uint16Array(n);
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const f = rows[i].split('|');
      name[i] = f[0]; cc[i] = f[1]; la[i] = +f[2] / 1000; lo[i] = +f[3] / 1000; pop[i] = +f[4]; tz[i] = +f[5];
      const key = cityKey(Math.floor(la[i] * 4), Math.floor(lo[i] * 4));
      let arr = grid.get(key);
      if (!arr) grid.set(key, (arr = []));
      arr.push(i);
    }
    // Barrios y distritos de una gran ciudad (Nakano → Tokio, Baixa → Lisboa) cuentan como esa ciudad.
    const parent = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      if (pop[i] < 300000) continue;
      const mega = pop[i] >= 3000000, radius = pop[i] >= 8000000 ? 16 : mega ? 12 : 5;
      const gy = Math.floor(la[i] * 4), gx = Math.floor(lo[i] * 4);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const arr = grid.get(cityKey(gy + dy, gx + dx));
        if (!arr) continue;
        for (const j of arr) {
          if (j === i || cc[j] !== cc[i]) continue;
          const small = mega ? pop[j] < pop[i] / 5 : pop[j] < 60000 && pop[j] < pop[i] / 10;
          if (!small || hav(la[i], lo[i], la[j], lo[j]) > radius * 1000) continue;
          if (parent[j] < 0 || pop[i] > pop[parent[j]]) parent[j] = i;
        }
      }
    }
    GEO = { C, cities: { name, cc, la, lo, pop, tz, grid, parent, tzNames: cities.tz } };
  }
  function cityKey(gy, gx) { return (gy + 400) * 2000 + (gx + 800); }

  function inRing(r, x, y) {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segDist2(px, py, ax, ay, bx, by, k) { // distancia² aproximada en grados, con corrección de longitud
    ax *= k; bx *= k; px *= k;
    const dx = bx - ax, dy = by - ay;
    let t = dx || dy ? ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy) : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    return ex * ex + ey * ey;
  }
  function countryAt(y, x) {
    const C = GEO.C;
    for (let ci = 0; ci < C.length; ci++) {
      const c = C[ci], b = c.box;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      for (let p = 0; p < c.polys.length; p++) {
        const q = c.bb[p];
        if (x < q[0] || x > q[2] || y < q[1] || y > q[3]) continue;
        let inside = false;
        for (const r of c.polys[p]) if (inRing(r, x, y)) inside = !inside;
        if (inside) return ci;
      }
    }
    // Costa, puerto o playa: el país más cercano a menos de ~25 km.
    const lim = 0.25, k = Math.cos(y * RAD);
    let best = -1, bd = lim * lim;
    for (let ci = 0; ci < C.length; ci++) {
      const b = C[ci].box;
      if (x < b[0] - lim / k || x > b[2] + lim / k || y < b[1] - lim || y > b[3] + lim) continue;
      for (let p = 0; p < C[ci].polys.length; p++) {
        const q = C[ci].bb[p];
        if (x < q[0] - lim / k || x > q[2] + lim / k || y < q[1] - lim || y > q[3] + lim) continue;
        for (const r of C[ci].polys[p]) {
          for (let i = 2; i < r.length; i += 2) {
            const d = segDist2(x, y, r[i - 2], r[i - 1], r[i], r[i + 1], k);
            if (d < bd) { bd = d; best = ci; }
          }
        }
      }
    }
    return best;
  }
  function nearestCity(y, x, maxKm) {
    const G = GEO.cities;
    const gy = Math.floor(y * 4), gx = Math.floor(x * 4);
    const ring = Math.max(1, Math.ceil(maxKm / 27));
    let best = -1, bd = maxKm * 1000;
    for (let r = 0; r <= ring; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dy), Math.abs(dx)) !== r) continue;
          const arr = G.grid.get(cityKey(gy + dy, gx + dx));
          if (!arr) continue;
          for (const i of arr) {
            const d = hav(y, x, G.la[i], G.lo[i]);
            // Las ciudades grandes «atraen» un poco más: un punto entre un pueblo y Barcelona es Barcelona.
            const score = d / (1 + Math.log10(Math.max(5000, G.pop[i]) / 5000) * 0.5);
            if (score < bd) { bd = score; best = i; }
          }
        }
      }
      if (best >= 0 && r >= 1 && bd < (r - 0.5) * 27000) break;
    }
    return best;
  }
  const cellCountry = new Map(), cellCity = new Map();
  function cellKey(y, x) { return (Math.floor(y * 50) + 4600) * 20000 + (Math.floor(x * 50) + 9100); }
  function countryOf(y, x) {
    const k = cellKey(y, x);
    let v = cellCountry.get(k);
    if (v === undefined) { v = countryAt((Math.floor(y * 50) + 0.5) / 50, (Math.floor(x * 50) + 0.5) / 50); if (v < 0) v = countryAt(y, x); cellCountry.set(k, v); }
    return v;
  }
  function cityOf(y, x) {
    const k = cellKey(y, x);
    let v = cellCity.get(k);
    if (v === undefined) {
      v = nearestCity((Math.floor(y * 50) + 0.5) / 50, (Math.floor(x * 50) + 0.5) / 50, 14);
      if (v >= 0 && GEO.cities.parent[v] >= 0) v = GEO.cities.parent[v];
      cellCity.set(k, v);
    }
    return v;
  }
  const tzFmt = new Map(), tzCache = new Map();
  function tzOffset(tzIdx, ms) {
    const bucket = Math.floor(ms / (6 * HOUR));
    const key = tzIdx * 1e6 + (bucket % 1e6);
    let v = tzCache.get(key);
    if (v !== undefined) return v;
    let f = tzFmt.get(tzIdx);
    if (f === undefined) {
      try { f = new Intl.DateTimeFormat('en-US', { timeZone: GEO.cities.tzNames[tzIdx], hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }); }
      catch (e) { f = null; }
      tzFmt.set(tzIdx, f);
    }
    if (!f) v = -new Date(ms).getTimezoneOffset();
    else {
      const p = {};
      for (const part of f.formatToParts(new Date(bucket * 6 * HOUR + 3 * HOUR))) p[part.type] = +part.value;
      const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
      v = Math.round((asUtc - (bucket * 6 * HOUR + 3 * HOUR)) / MIN);
      if (!(Math.abs(v) <= 900)) v = 0;
    }
    tzCache.set(key, v);
    return v;
  }

  // Exónimos en español de las ciudades más visitadas (GeoNames da el nombre en inglés o local).
  const ES_NAMES = {
    'London': 'Londres', 'Rome': 'Roma', 'Lisbon': 'Lisboa', 'New York City': 'Nueva York', 'Tokyo': 'Tokio', 'Paris': 'París',
    'Munich': 'Múnich', 'Milan': 'Milán', 'Naples': 'Nápoles', 'Florence': 'Florencia', 'Venice': 'Venecia', 'Turin': 'Turín',
    'Genoa': 'Génova', 'Bologna': 'Bolonia', 'Syracuse': 'Siracusa', 'Padua': 'Padua', 'Geneva': 'Ginebra', 'Zurich': 'Zúrich',
    'Bern': 'Berna', 'Basel': 'Basilea', 'Brussels': 'Bruselas', 'Antwerp': 'Amberes', 'Bruges': 'Brujas', 'Ghent': 'Gante',
    'The Hague': 'La Haya', 'Copenhagen': 'Copenhague', 'Stockholm': 'Estocolmo', 'Gothenburg': 'Gotemburgo', 'Helsinki': 'Helsinki',
    'Moscow': 'Moscú', 'Saint Petersburg': 'San Petersburgo', 'Warsaw': 'Varsovia', 'Krakow': 'Cracovia', 'Kraków': 'Cracovia',
    'Prague': 'Praga', 'Vienna': 'Viena', 'Athens': 'Atenas', 'Berlin': 'Berlín', 'Hamburg': 'Hamburgo', 'Cologne': 'Colonia',
    'Frankfurt am Main': 'Fráncfort', 'Nuremberg': 'Núremberg', 'Dresden': 'Dresde', 'Bucharest': 'Bucarest', 'Budapest': 'Budapest',
    'Belgrade': 'Belgrado', 'Sofia': 'Sofía', 'Kyiv': 'Kiev', 'Kiev': 'Kiev', 'Vilnius': 'Vilna', 'Edinburgh': 'Edimburgo',
    'Dublin': 'Dublín', 'Cardiff': 'Cardiff', 'Bordeaux': 'Burdeos', 'Marseille': 'Marsella', 'Nice': 'Niza', 'Strasbourg': 'Estrasburgo',
    'Avignon': 'Aviñón', 'Perpignan': 'Perpiñán', 'Toulouse': 'Toulouse', 'Lille': 'Lille', 'Nantes': 'Nantes', 'Rouen': 'Ruan',
    'Cairo': 'El Cairo', 'Alexandria': 'Alejandría', 'Marrakesh': 'Marrakech', 'Tangier': 'Tánger', 'Fes': 'Fez', 'Algiers': 'Argel',
    'Tunis': 'Túnez', 'Cape Town': 'Ciudad del Cabo', 'Beijing': 'Pekín', 'Shanghai': 'Shanghái', 'Seoul': 'Seúl', 'Kyoto': 'Kioto',
    'Singapore': 'Singapur', 'New Delhi': 'Nueva Delhi', 'Delhi': 'Delhi', 'Mumbai': 'Bombay', 'Hong Kong': 'Hong Kong',
    'Taipei': 'Taipéi', 'Hanoi': 'Hanói', 'Ho Chi Minh City': 'Ciudad Ho Chi Minh', 'Kathmandu': 'Katmandú', 'Tehran': 'Teherán',
    'Istanbul': 'Estambul', 'Jerusalem': 'Jerusalén', 'Tel Aviv': 'Tel Aviv', 'Dubai': 'Dubái', 'Abu Dhabi': 'Abu Dabi',
    'Mexico City': 'Ciudad de México', 'Havana': 'La Habana', 'Philadelphia': 'Filadelfia', 'New Orleans': 'Nueva Orleans',
    'Rio de Janeiro': 'Río de Janeiro', 'Sao Paulo': 'São Paulo', 'São Paulo': 'São Paulo', 'Montreal': 'Montreal',
    'Quebec': 'Quebec', 'Washington, D.C.': 'Washington D. C.', 'Saint Louis': 'San Luis', 'San Francisco': 'San Francisco',
    'Reykjavik': 'Reikiavik', 'Oslo': 'Oslo', 'Luxembourg': 'Luxemburgo', 'Monaco': 'Mónaco', 'Valletta': 'La Valeta',
    'Salzburg': 'Salzburgo', 'Innsbruck': 'Innsbruck', 'Seville': 'Sevilla', 'Saragossa': 'Zaragoza', 'Corunna': 'A Coruña',
    'Porto': 'Oporto', 'Braga': 'Braga', 'Coimbra': 'Coímbra', 'Pisa': 'Pisa', 'Verona': 'Verona', 'Palermo': 'Palermo',
    'Catania': 'Catania', 'Bergen': 'Bergen', 'Riga': 'Riga', 'Tallinn': 'Tallin', 'Bratislava': 'Bratislava', 'Ljubljana': 'Liubliana',
    'Zagreb': 'Zagreb', 'Split': 'Split', 'Dubrovnik': 'Dubrovnik', 'Valencia': 'Valencia', 'Andorra la Vella': 'Andorra la Vieja',
    'Los Angeles': 'Los Ángeles', 'Las Vegas': 'Las Vegas', 'San Diego': 'San Diego', 'Honolulu': 'Honolulú', 'Toronto': 'Toronto', 'Cancun': 'Cancún', 'Bogota': 'Bogotá', 'Medellin': 'Medellín', 'Lima': 'Lima',
  };

  // ------------------------------------------------------------------ análisis
  function sortOrder(t, n) {
    const order = new Uint32Array(n);
    let sorted = true;
    for (let i = 1; i < n; i++) if (t[i] < t[i - 1]) { sorted = false; break; }
    if (sorted) { for (let i = 0; i < n; i++) order[i] = i; return order; }
    let t0 = Infinity, t1 = -Infinity;
    for (let i = 0; i < n; i++) { if (t[i] < t0) t0 = t[i]; if (t[i] > t1) t1 = t[i]; }
    const span = (t1 - t0) / 1000;
    if (n < 8388608 && span < 1073741824) {
      // Truco: segundos e índice empaquetados en un Float64 → orden nativo, mucho más rápido que un comparador.
      const keys = new Float64Array(n);
      for (let i = 0; i < n; i++) keys[i] = Math.floor((t[i] - t0) / 1000) * 8388608 + i;
      keys.sort();
      for (let i = 0; i < n; i++) order[i] = keys[i] % 8388608;
      return order;
    }
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => t[a] - t[b]);
    return order;
  }

  function lowerBound(arr, v, n) { let lo = 0, hi = n === undefined ? arr.length : n; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }

  function analyze() {
    const t0Clock = Date.now();
    const W = S.warnings;
    let n = S.n;
    if (n === 0 && !S.visits.length) {
      const errs = S.files.filter((f) => f.error);
      if (errs.length === S.files.length && errs.length) throw new Error(errs.map((f) => f.name + ': ' + f.error).join('\n'));
      throw new Error('No se encontró ninguna ubicación en ' + (S.files.length > 1 ? 'los archivos' : 'el archivo') + '. ¿Es la exportación de la Cronología de Google Maps?');
    }
    progress('analyze', 0.02, 'Ordenando ' + n.toLocaleString('es-ES') + ' puntos', true);
    const order = sortOrder(S.t, n);

    // 1 · limpieza: fechas imposibles, precisión pésima y duplicados exactos
    const tLo = Date.UTC(1995, 0, 1), tHi = Date.now() + 2 * DAY;
    let T = new Float64Array(n), LA = new Float64Array(n), LO = new Float64Array(n), OF = new Int16Array(n), SR = new Uint8Array(n), AL = new Float32Array(n);
    let m = 0, lowAcc = 0, dup = 0, bad = 0;
    for (let q = 0; q < n; q++) {
      const k = order[q];
      const t = S.t[k];
      if (!(t >= tLo && t <= tHi)) { bad++; continue; }
      if (S.acc[k] > 1500) { lowAcc++; continue; }
      if (m > 0 && t - T[m - 1] < 1000 && Math.abs(S.la[k] - LA[m - 1]) < 3e-5 && Math.abs(S.lo[k] - LO[m - 1]) < 3e-5) { dup++; continue; }
      T[m] = t; LA[m] = S.la[k]; LO[m] = S.lo[k]; OF[m] = S.off[k]; SR[m] = S.src[k]; AL[m] = S.acc[k] <= 100 ? S.alt[k] : NaN;
      m++;
    }
    const rawCount = n;
    // liberamos los buffers de lectura
    S.t = S.la = S.lo = S.acc = S.off = S.src = S.alt = null;
    if (bad + S.badTime > 0) W.push(pl(bad + S.badTime, 'punto con fecha imposible descartado', 'puntos con fecha imposible descartados'));
    if (lowAcc > 0) W.push(pl(lowAcc, 'punto con precisión peor de 1,5 km descartado', 'puntos con precisión peor de 1,5 km descartados'));

    // 2 · picos de GPS: un punto que «salta» lejos y vuelve enseguida
    progress('analyze', 0.08, 'Eliminando saltos de GPS', true);
    const keep = new Uint8Array(m).fill(1);
    let spikes = 0;
    for (let pass = 0; pass < 2; pass++) {
      let prev = -1;
      for (let i = 0; i < m; i++) {
        if (!keep[i]) continue;
        if (prev < 0 || SR[i] !== SRC_RAW) { prev = i; continue; }
        let next = i + 1;
        while (next < m && !keep[next]) next++;
        if (next >= m) break;
        const d1 = hav(LA[prev], LO[prev], LA[i], LO[i]), d2 = hav(LA[i], LO[i], LA[next], LO[next]);
        const v1 = d1 / Math.max(1, (T[i] - T[prev]) / 1000), v2 = d2 / Math.max(1, (T[next] - T[i]) / 1000);
        if (d1 > 1500 && v1 > 70 && v2 > 70 && hav(LA[prev], LO[prev], LA[next], LO[next]) < 0.35 * Math.min(d1, d2)) { keep[i] = 0; spikes++; continue; }
        if (v1 > 400 && d1 > 5000 && (T[i] - T[prev]) < 10 * MIN) { keep[i] = 0; spikes++; continue; }
        prev = i;
      }
    }
    if (spikes) W.push(pl(spikes, 'salto de GPS corregido', 'saltos de GPS corregidos'));

    // 3 · aligerado: en parado basta un punto cada 10 min; cada punto pesa el tiempo que «representa»
    progress('analyze', 0.14, 'Simplificando recorridos', true);
    let k = 0, last = -1;
    const idx = new Uint32Array(m);
    for (let i = 0; i < m; i++) {
      if (!keep[i]) continue;
      if (last >= 0 && SR[i] !== SRC_VISIT && SR[i] !== SRC_ACT && T[i] - T[last] < 10 * MIN && hav(LA[last], LO[last], LA[i], LO[i]) < 25) continue;
      idx[k++] = i; last = i;
    }
    const N = k;
    const t = new Float64Array(N), la = new Float32Array(N), lo = new Float32Array(N), off = new Int16Array(N), alt = new Float32Array(N), w = new Float32Array(N);
    const lad = new Float64Array(N), lod = new Float64Array(N);
    for (let q = 0; q < N; q++) {
      const i = idx[q];
      t[q] = T[i]; lad[q] = LA[i]; lod[q] = LO[i]; la[q] = LA[i]; lo[q] = LO[i]; off[q] = OF[i]; alt[q] = AL[i];
    }
    T = LA = LO = OF = SR = AL = null;
    for (let q = 0; q < N - 1; q++) {
      const dt = (t[q + 1] - t[q]) / MIN;
      const near = hav(lad[q], lod[q], lad[q + 1], lod[q + 1]) < 300;
      w[q] = Math.min(dt, near ? 3 * 24 * 60 : 120);
    }
    if (N) w[N - 1] = 10;

    // 4 · país y ciudad de cada punto
    progress('analyze', 0.22, 'Identificando países y ciudades', true);
    const pc = new Int16Array(N), pci = new Int32Array(N);
    for (let q = 0; q < N; q++) {
      pc[q] = countryOf(lad[q], lod[q]);
      pci[q] = cityOf(lad[q], lod[q]);
      if ((q & 16383) === 0) progress('analyze', 0.22 + 0.18 * (q / N), 'Identificando países y ciudades');
    }

    // 5 · hora local: si el archivo no trae el desfase, se deduce del huso de la ciudad más cercana
    progress('analyze', 0.41, 'Ajustando husos horarios', true);
    let known = 0;
    for (let q = 0; q < N; q++) if (off[q] !== NOOFF) known++;
    if (known < N) {
      let lastKnown = -1;
      for (let q = 0; q < N; q++) {
        if (off[q] !== NOOFF) { lastKnown = q; continue; }
        if (lastKnown >= 0 && t[q] - t[lastKnown] < 12 * HOUR && known > N * 0.5) { off[q] = off[lastKnown]; continue; }
        let ci = pci[q];
        if (ci < 0) ci = nearestCity(lad[q], lod[q], 400);
        off[q] = ci >= 0 ? tzOffset(GEO.cities.tz[ci], t[q]) : -new Date(t[q]).getTimezoneOffset();
      }
    }

    // 6 · días locales
    const dayOf = (ms, o) => Math.floor((ms + o * MIN) / DAY);
    let day0 = Infinity, day1 = -Infinity;
    for (let q = 0; q < N; q++) { const d = dayOf(t[q], off[q]); if (d < day0) day0 = d; if (d > day1) day1 = d; }

    // 7 · visitas y actividades: orden, duplicados, ubicación
    progress('analyze', 0.48, 'Organizando visitas y trayectos', true);
    const offNear = (ms) => { if (!N) return 0; let q = lowerBound(t, ms); if (q >= N) q = N - 1; return off[q]; };
    let visits = S.visits.filter((v) => v.s >= tLo && v.s <= tHi).sort((a, b) => a.s - b.s);
    visits = visits.filter((v, i) => i === 0 || !(Math.abs(v.s - visits[i - 1].s) < MIN && hav(v.la, v.lo, visits[i - 1].la, visits[i - 1].lo) < 200));
    let acts = S.acts.filter((a) => a.s >= tLo && a.s <= tHi && a.mode !== STILL).sort((a, b) => a.s - b.s);
    acts = acts.filter((a, i) => i === 0 || !(Math.abs(a.s - acts[i - 1].s) < MIN && a.mode === acts[i - 1].mode));
    for (const v of visits) if (v.off === NOOFF || v.off !== v.off) v.off = offNear(v.s);
    for (const a of acts) if (a.off === NOOFF || a.off !== a.off) a.off = offNear(a.s);
    for (const d of [visits.length ? dayOf(visits[0].s, visits[0].off) : Infinity, acts.length ? dayOf(acts[0].s, acts[0].off) : Infinity]) if (d < day0) day0 = d;
    if (visits.length) { const v = visits[visits.length - 1]; day1 = Math.max(day1, dayOf(v.e, v.off)); }

    // estancias detectadas cuando el archivo solo trae puntos (Records.json, GPX…)
    let inferredStays = false;
    if (!visits.length && N > 1) {
      inferredStays = true;
      let i = 0;
      while (i < N) {
        let j = i + 1;
        while (j < N && hav(lad[i], lod[i], lad[j], lod[j]) < 150) j++;
        if (t[j - 1] - t[i] >= 15 * MIN) {
          let sy = 0, sx = 0;
          for (let q = i; q < j; q++) { sy += lad[q]; sx += lod[q]; }
          const v = { s: t[i], e: t[j - 1], la: sy / (j - i), lo: sx / (j - i), off: off[i], pid: '', st: '', name: '', addr: '' };
          const pv = visits[visits.length - 1];
          if (pv && hav(pv.la, pv.lo, v.la, v.lo) < 150 && v.s - pv.e < HOUR) { pv.e = v.e; }
          else visits.push(v);
          i = j;
        } else i++;
      }
    }

    // 8 · lugares: visitas agrupadas por placeId o por cercanía (~150 m)
    progress('analyze', 0.55, 'Agrupando lugares', true);
    const placeMap = new Map();
    const places = [];
    for (const v of visits) {
      const key = v.pid ? 'p' + v.pid : 'g' + Math.round(v.la * 700) + ',' + Math.round(v.lo * 700);
      let p = placeMap.get(key);
      if (!p) {
        p = { key, pid: v.pid, sy: 0, sx: 0, n: 0, min: 0, first: v.s, last: v.e, st: { home: 0, work: 0 }, name: '', addr: '', night: 0, weekday: 0 };
        placeMap.set(key, p);
        places.push(p);
      }
      const dur = Math.max(0, (v.e - v.s) / MIN);
      p.sy += v.la; p.sx += v.lo; p.n++; p.min += dur;
      if (v.s < p.first) p.first = v.s;
      if (v.e > p.last) p.last = v.e;
      if (v.st) p.st[v.st]++;
      if (v.name && !p.name) p.name = v.name;
      if (v.addr && !p.addr) p.addr = v.addr;
      // horas nocturnas y laborables para adivinar casa y trabajo
      for (let h = v.s; h < v.e && h < v.s + 14 * DAY; h += HOUR) {
        const lt = new Date(h + v.off * MIN);
        const hr = lt.getUTCHours(), wd = lt.getUTCDay();
        if (hr < 6 || hr >= 22) p.night++;
        else if (wd >= 1 && wd <= 5 && hr >= 9 && hr < 18) p.weekday++;
      }
      v.place = p;
    }
    for (const p of places) { p.la = p.sy / p.n; p.lo = p.sx / p.n; }
    for (const f of S.profile) {
      if (!f.type) continue;
      let best = null, bd = 250;
      for (const p of places) { if ((f.pid && p.pid === f.pid) || hav(p.la, p.lo, f.la, f.lo) < bd) { best = p; if (f.pid && p.pid === f.pid) break; bd = hav(p.la, p.lo, f.la, f.lo); } }
      if (best) best.st[f.type] += 1000;
    }
    let homeP = null, workP = null;
    for (const p of places) {
      if (p.st.home > 0 && (!homeP || p.st.home * 100 + p.night > homeP.st.home * 100 + homeP.night)) homeP = p;
    }
    if (!homeP) for (const p of places) if (p.night > 24 && (!homeP || p.night > homeP.night)) homeP = p;
    for (const p of places) {
      if (p === homeP) continue;
      if (p.st.work > 0 && (!workP || p.st.work * 100 + p.weekday > workP.st.work * 100 + workP.weekday)) workP = p;
    }
    if (!workP) for (const p of places) if (p !== homeP && p.weekday > 80 && (!workP || p.weekday > workP.weekday)) workP = p;
    places.sort((a, b) => b.min - a.min);
    const placeIndex = new Map(places.map((p, i) => [p, i]));

    // 9 · casa por mes (lugar donde más noches se pasa); permite detectar viajes aunque te mudes
    progress('analyze', 0.6, 'Detectando tu casa y tus viajes', true);
    const monthOf = (ms, o) => { const d = new Date(ms + o * MIN); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
    const nightCells = new Map();
    for (let q = 0; q < N; q++) {
      // minutos nocturnos (22–6 h, hora local) que cubre este punto; con datos escasos un punto puede valer horas
      const start = t[q] + off[q] * MIN, span = Math.min(w[q], 24 * 60);
      let night = 0;
      for (let x = 0; x < span; x += 30) {
        const hr = new Date(start + x * MIN).getUTCHours();
        if (hr < 6 || hr >= 22) night += Math.min(30, span - x);
      }
      if (!night) continue;
      const lt = new Date(start);
      const mo = lt.getUTCFullYear() * 12 + lt.getUTCMonth();
      const key = mo + '|' + Math.round(lad[q] * 200) + ',' + Math.round(lod[q] * 200);
      const c = nightCells.get(key);
      if (c) { c.w += night; c.sy += lad[q] * night; c.sx += lod[q] * night; c.ws += night; }
      else nightCells.set(key, { mo, w: night, sy: lad[q] * night, sx: lod[q] * night, ws: night });
    }
    const bestByMonth = new Map();
    for (const c of nightCells.values()) {
      const b = bestByMonth.get(c.mo);
      if (!b || c.w > b.w) bestByMonth.set(c.mo, c);
    }
    const homes = [];
    const months = Array.from(bestByMonth.keys()).sort((a, b) => a - b);
    for (const mo of months) {
      const c = bestByMonth.get(mo);
      if (c.w < 4 * 360 && homes.length) continue; // pocas noches: probablemente de viaje, se hereda la casa anterior
      let hla = c.sy / c.ws, hlo = c.sx / c.ws;
      if (homeP && hav(hla, hlo, homeP.la, homeP.lo) < 600) { hla = homeP.la; hlo = homeP.lo; }
      const prev = homes[homes.length - 1];
      if (prev && hav(prev.la, prev.lo, hla, hlo) < 1500) continue;
      homes.push({ mo, la: hla, lo: hlo });
    }
    if (!homes.length && homeP) homes.push({ mo: -Infinity, la: homeP.la, lo: homeP.lo });
    if (homes.length) homes[0].mo = -Infinity;
    const homeAt = (mo) => { let h = null; for (const x of homes) { if (x.mo <= mo) h = x; else break; } return h || homes[0] || null; };
    const dh = new Float32Array(N);
    for (let q = 0; q < N; q++) {
      const h = homeAt(monthOf(t[q], off[q]));
      dh[q] = h ? hav(lad[q], lod[q], h.la, h.lo) / 1000 : 0;
    }

    // 10 · tramos dibujables: se cortan en huecos largos, cambios de medio de transporte y de país
    progress('analyze', 0.66, 'Reconstruyendo tus recorridos', true);
    // intervalos ordenados por inicio + máximo acumulado del final → «¿qué intervalo cubre este instante?» en O(log n)
    function intervals(list) {
      const n2 = list.length, s = new Float64Array(n2), e = new Float64Array(n2), mx = new Float64Array(n2);
      for (let i = 0; i < n2; i++) { s[i] = list[i].s; e[i] = list[i].e; mx[i] = Math.max(e[i], i ? mx[i - 1] : -Infinity); }
      return { s, e, mx };
    }
    const actI = intervals(acts), visI = intervals(visits);
    function cover(I, ms) {
      let i = lowerBound(I.s, ms + 1) - 1;
      while (i >= 0 && I.mx[i] >= ms) { if (I.e[i] >= ms) return i; i--; }
      return -1;
    }
    const segPos = [], segTs = [], segStart = [0], segMode = [], segC = [], segC2 = [], segT0 = [], segT1 = [], segKm = [], segInf = [];
    let curMode = -9, curC = -9, curC2 = -9, open = false, curKm = 0, curInf = 0, vtx = 0;
    const T0 = N ? t[0] : visits.length ? visits[0].s : 0;
    const pushV = (y, x, ms) => { segPos.push(x, y); segTs.push((ms - T0) / MIN); vtx++; };
    function close() {
      if (!open) return;
      if (vtx - segStart[segStart.length - 1] >= 2) {
        segStart.push(vtx); segMode.push(curMode); segC.push(curC); segC2.push(curC2); segKm.push(curKm); segInf.push(curInf);
        segT1.push(T0 + segTs[segTs.length - 1] * MIN);
      } else {
        vtx = segStart[segStart.length - 1];
        segPos.length = vtx * 2; segTs.length = vtx;
        segT0.pop();
      }
      open = false;
    }
    const dayKmSeg = new Map(); // día*8+modo → km de tramos (para días sin actividades)
    const pairPlane = new Uint8Array(N + 1); // pairPlane[q] = 1 si el tramo (q-1 → q) es en avión
    const hourMove = new Float32Array(Math.max(1, (day1 - day0 + 1)) * 24);
    for (let q = 1; q < N; q++) {
      const dt = t[q] - t[q - 1];
      const d = hav(lad[q - 1], lod[q - 1], lad[q], lod[q]);
      const v = d / Math.max(1, dt / 1000);
      const mid = t[q - 1] + dt / 2;
      let mode, inf = 0;
      const ai = acts.length ? cover(actI, mid) : -1;
      if (ai >= 0) mode = acts[ai].mode, inf = acts[ai].inferred ? 1 : 0;
      else if (visits.length && cover(visI, mid) >= 0) mode = STILL;
      else {
        inf = 1;
        if (d > 100000 && v > 55 && v < 320) mode = PLANE;
        else if (dt > 3 * HOUR || d < 30) mode = STILL;
        // sin actividad que lo diga, se estima por velocidad: a pie, coche, tren de alta velocidad o avión
        else mode = v < 0.5 ? STILL : v < 2.4 ? WALK : v < 45 ? CAR : v < 90 ? TRAIN : v < 320 && d > 5000 ? PLANE : STILL;
      }
      if (v > 350 || (dt > 6 * HOUR && mode !== PLANE) || (mode !== PLANE && v > 110 && d > 20000)) mode = STILL;
      if (mode === STILL || mode === UNK) { close(); continue; }
      if (mode === PLANE) pairPlane[q] = 1;
      const c = pc[q - 1];
      if (!open || mode !== curMode || c !== curC) {
        close();
        open = true; curMode = mode; curC = c; curKm = 0; curInf = inf;
        segT0.push(t[q - 1]);
        pushV(lad[q - 1], lod[q - 1], t[q - 1]);
      }
      if (mode === PLANE && d > 80000) {
        // vuelo: arco de círculo máximo con el tiempo repartido
        const steps = Math.min(64, Math.max(8, Math.round(d / 60000)));
        const p1 = [lad[q - 1] * RAD, lod[q - 1] * RAD], p2 = [lad[q] * RAD, lod[q] * RAD];
        const ang = d / 6371008.8;
        for (let s2 = 1; s2 < steps; s2++) {
          const f = s2 / steps;
          const A = Math.sin((1 - f) * ang) / Math.sin(ang), B = Math.sin(f * ang) / Math.sin(ang);
          const x = A * Math.cos(p1[0]) * Math.cos(p1[1]) + B * Math.cos(p2[0]) * Math.cos(p2[1]);
          const y = A * Math.cos(p1[0]) * Math.sin(p1[1]) + B * Math.cos(p2[0]) * Math.sin(p2[1]);
          const z = A * Math.sin(p1[0]) + B * Math.sin(p2[0]);
          let gl = Math.atan2(y, x) / RAD;
          while (gl - segPos[segPos.length - 2] > 180) gl -= 360; // sin saltos al cruzar el antimeridiano
          while (gl - segPos[segPos.length - 2] < -180) gl += 360;
          pushV(Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, gl, t[q - 1] + dt * f);
        }
      }
      let endLon = lod[q];
      if (mode === PLANE) { while (endLon - segPos[segPos.length - 2] > 180) endLon -= 360; while (endLon - segPos[segPos.length - 2] < -180) endLon += 360; }
      pushV(lad[q], endLon, t[q]);
      curKm += d / 1000;
      curC2 = pc[q];
      if (inf) curInf = 1;
      const day = dayOf(t[q - 1], off[q - 1]) - day0;
      const key = day * NM + mode;
      dayKmSeg.set(key, (dayKmSeg.get(key) || 0) + d / 1000);
      const lt = new Date(t[q - 1] + off[q - 1] * MIN);
      if (day >= 0 && day < hourMove.length / 24) hourMove[day * 24 + lt.getUTCHours()] += Math.min(dt, 3 * HOUR) / MIN;
    }
    close();

    // 11 · agregados por día
    progress('analyze', 0.78, 'Calculando estadísticas por día', true);
    const nD = Math.max(1, day1 - day0 + 1);
    const kmMode = new Float32Array(nD * NM), minMode = new Float32Array(nD * NM), dPts = new Uint32Array(nD), maxHome = new Float32Array(nD), dOff = new Int16Array(nD).fill(NOOFF);
    const dayHasAct = new Uint8Array(nD);
    for (const a of acts) {
      const d = dayOf(a.s, a.off) - day0;
      if (d < 0 || d >= nD) continue;
      dayHasAct[d] = 1;
      kmMode[d * NM + a.mode] += a.d / 1000;
      minMode[d * NM + a.mode] += (a.e - a.s) / MIN;
    }
    for (const [key, km] of dayKmSeg) {
      const d = Math.floor(key / NM);
      if (d >= 0 && d < nD && !dayHasAct[d]) kmMode[key] += km;
    }
    // minutos por modo para días sin actividades, a partir de los tramos
    for (let s2 = 0; s2 < segMode.length; s2++) {
      const tt = segT0[s2];
      const q = Math.min(N - 1, lowerBound(t, tt));
      const d = dayOf(tt, off[q]) - day0;
      if (d >= 0 && d < nD && !dayHasAct[d]) minMode[d * NM + segMode[s2]] += (segT1[s2] - segT0[s2]) / MIN;
    }
    // puntos en pleno vuelo: sobrevolar un país no cuenta como visitarlo
    const air = new Uint8Array(N);
    for (let q = 1; q < N - 1; q++) if (pairPlane[q] && pairPlane[q + 1]) air[q] = 1;
    const dc = new Map(), dci = new Map();
    for (let q = 0; q < N; q++) {
      const d = dayOf(t[q], off[q]) - day0;
      dPts[d]++;
      if (air[q]) continue;
      if (dOff[d] === NOOFF) dOff[d] = off[q];
      if (dh[q] > maxHome[d]) maxHome[d] = dh[q];
      const wv = w[q];
      if (pc[q] >= 0) { const key = d * 512 + pc[q]; dc.set(key, (dc.get(key) || 0) + wv); }
      if (pci[q] >= 0) { const key = d * 100000 + pci[q]; dci.set(key, (dci.get(key) || 0) + wv); }
    }
    for (const v of visits) {
      const d = dayOf(v.s, v.off) - day0;
      if (d >= 0 && d < nD && dOff[d] === NOOFF) dOff[d] = v.off;
      v.c = countryOf(v.la, v.lo);
      v.ci = cityOf(v.la, v.lo);
      if (d >= 0 && d < nD) {
        if (v.c >= 0 && !dc.has(d * 512 + v.c)) dc.set(d * 512 + v.c, 1);
        if (v.ci >= 0 && !dci.has(d * 100000 + v.ci)) dci.set(d * 100000 + v.ci, 1);
      }
    }
    let lastOff = 0;
    for (let d = 0; d < nD; d++) { if (dOff[d] === NOOFF) dOff[d] = lastOff; else lastOff = dOff[d]; }
    const kmCountry = new Map(); // día*512+país → km
    for (const a of acts) {
      a.c = countryOf(a.la1, a.lo1);
      a.c2 = countryOf(a.la2, a.lo2);
      a.ci1 = cityOf(a.la1, a.lo1); a.ci2 = cityOf(a.la2, a.lo2);
      const d = dayOf(a.s, a.off) - day0;
      // un vuelo internacional no suma kilómetros a ningún país
      if (a.c >= 0 && d >= 0 && d < nD && !(a.mode === PLANE && a.c !== a.c2)) { const key = d * 512 + a.c; kmCountry.set(key, (kmCountry.get(key) || 0) + a.d / 1000); }
    }
    for (let s2 = 0; s2 < segMode.length; s2++) {
      const q = Math.min(N - 1, lowerBound(t, segT0[s2]));
      const d = dayOf(segT0[s2], off[q]) - day0;
      if (segC[s2] >= 0 && d >= 0 && d < nD && !dayHasAct[d] && !(segMode[s2] === PLANE && segC[s2] !== segC2[s2])) { const key = d * 512 + segC[s2]; kmCountry.set(key, (kmCountry.get(key) || 0) + segKm[s2]); }
    }
    const dcKeys = Array.from(new Set([...dc.keys(), ...kmCountry.keys()])).sort((a, b) => a - b);
    const dcD = new Int32Array(dcKeys.length), dcC = new Int16Array(dcKeys.length), dcMin = new Float32Array(dcKeys.length), dcKm = new Float32Array(dcKeys.length);
    dcKeys.forEach((key, i) => { dcD[i] = Math.floor(key / 512); dcC[i] = key % 512; dcMin[i] = dc.get(key) || 0; dcKm[i] = kmCountry.get(key) || 0; });

    // ciudades: solo las que se usan, renumeradas
    const cityUsed = new Map(), cityList = [];
    const G = GEO.cities;
    function cityLocal(ci) {
      if (ci < 0) return -1;
      let v = cityUsed.get(ci);
      if (v === undefined) {
        v = cityList.length;
        cityUsed.set(ci, v);
        cityList.push({ n: ES_NAMES[G.name[ci]] || G.name[ci], cc: G.cc[ci], la: G.la[ci], lo: G.lo[ci], pop: G.pop[ci], c: countryOf(G.la[ci], G.lo[ci]) });
      }
      return v;
    }
    const dciKeys = Array.from(dci.keys()).sort((a, b) => a - b);
    const ciD = new Int32Array(dciKeys.length), ciC = new Int32Array(dciKeys.length), ciMin = new Float32Array(dciKeys.length);
    dciKeys.forEach((key, i) => { ciD[i] = Math.floor(key / 100000); ciC[i] = cityLocal(key % 100000); ciMin[i] = dci.get(key); });
    for (let q = 0; q < N; q++) pci[q] = cityLocal(pci[q]);

    // 12 · viajes: días seguidos a más de 100 km de casa
    progress('analyze', 0.86, 'Detectando viajes', true);
    const trips = [];
    let d = 0;
    while (d < nD) {
      if (maxHome[d] < 100) { d++; continue; }
      let e = d;
      while (true) {
        let nx = e + 1;
        while (nx < nD && dPts[nx] === 0 && nx - e <= 2) nx++;
        if (nx < nD && maxHome[nx] >= 100 && nx - e <= 2) e = nx; else break;
      }
      trips.push({ d0: d, d1: e });
      d = e + 1;
    }
    for (let ti = trips.length - 1; ti >= 0; ti--) {
      const tr = trips[ti];
      if (lowerBound(t, (day0 + tr.d0) * DAY - dOff[tr.d0] * MIN) >= N) trips.splice(ti, 1);
    }
    for (const tr of trips) {
      const ms0 = (day0 + tr.d0) * DAY - dOff[tr.d0] * MIN, ms1 = (day0 + tr.d1 + 1) * DAY - dOff[tr.d1] * MIN;
      const q0 = lowerBound(t, ms0), q1 = Math.max(q0 + 1, Math.min(N, lowerBound(t, ms1)));
      let best = q0;
      const cs = new Map();
      for (let q = q0; q < q1; q++) {
        if (air[q]) continue;
        if (dh[q] > dh[best] || air[best]) best = q;
        if (pc[q] >= 0) cs.set(pc[q], (cs.get(pc[q]) || 0) + w[q]);
      }
      let km = 0;
      const modeKm = new Float32Array(NM);
      for (let dd = tr.d0; dd <= tr.d1; dd++) for (let mm = 0; mm < NM; mm++) { km += kmMode[dd * NM + mm]; modeKm[mm] += kmMode[dd * NM + mm]; }
      let mm = 0;
      for (let x = 1; x < NM; x++) if (modeKm[x] > modeKm[mm]) mm = x;
      const h = homeAt(monthOf(t[best], off[best]));
      // destino: la ciudad donde más tiempo se pasó lejos de casa (no la gasolinera más lejana)
      const cityTime = new Map();
      for (let q = q0; q < q1; q++) if (!air[q] && dh[q] > 60 && pci[q] >= 0) cityTime.set(pci[q], (cityTime.get(pci[q]) || 0) + Math.min(w[q], 600));
      let destCity = q1 > q0 ? pci[best] : -1, bestT = -1;
      for (const [ci, tt] of cityTime) if (tt > bestT) { bestT = tt; destCity = ci; }
      Object.assign(tr, {
        la: q1 > q0 ? la[best] : 0, lo: q1 > q0 ? lo[best] : 0, far: q1 > q0 ? dh[best] : 0,
        ci: destCity, c: destCity >= 0 ? cityList[destCity].c : (q1 > q0 ? pc[best] : -1),
        countries: Array.from(cs.entries()).sort((a, b) => b[1] - a[1]).map((x) => x[0]),
        km, mode: km > 0 ? mm : -1, hla: h ? h.la : 0, hlo: h ? h.lo : 0,
      });
      if (destCity >= 0) { tr.dla = cityList[destCity].la; tr.dlo = cityList[destCity].lo; } else { tr.dla = tr.la; tr.dlo = tr.lo; }
    }

    // 13 · salida compacta (typed arrays transferibles)
    progress('analyze', 0.93, 'Preparando el mapa', true);
    const nV = visits.length;
    const vS = new Float64Array(nV), vE = new Float64Array(nV), vOff = new Int16Array(nV), vP = new Int32Array(nV), vC = new Int16Array(nV), vCi = new Int32Array(nV);
    visits.forEach((v, i) => { vS[i] = v.s; vE[i] = v.e; vOff[i] = v.off; vP[i] = placeIndex.get(v.place); vC[i] = v.c; vCi[i] = cityLocal(v.ci); });
    const nA = acts.length;
    const aS = new Float64Array(nA), aE = new Float64Array(nA), aOff = new Int16Array(nA), aMode = new Int8Array(nA), aKm = new Float32Array(nA), aC = new Int16Array(nA);
    const aC2 = new Int16Array(nA), aLa1 = new Float32Array(nA), aLo1 = new Float32Array(nA), aLa2 = new Float32Array(nA), aLo2 = new Float32Array(nA), aCi1 = new Int32Array(nA), aCi2 = new Int32Array(nA), aInf = new Uint8Array(nA);
    acts.forEach((a, i) => {
      aS[i] = a.s; aE[i] = a.e; aOff[i] = a.off; aMode[i] = a.mode; aKm[i] = a.d / 1000; aC[i] = a.c; aC2[i] = a.c2;
      aLa1[i] = a.la1; aLo1[i] = a.lo1; aLa2[i] = a.la2; aLo2[i] = a.lo2; aCi1[i] = cityLocal(a.ci1); aCi2[i] = cityLocal(a.ci2); aInf[i] = a.inferred ? 1 : 0;
    });
    const placesOut = places.map((p) => {
      const c = countryOf(p.la, p.lo);
      return {
        la: p.la, lo: p.lo, pid: p.pid, name: p.name, addr: p.addr, n: p.n, min: p.min, first: p.first, last: p.last,
        type: p === homeP ? 'home' : p === workP ? 'work' : '', c, ci: cityLocal(cityOf(p.la, p.lo)),
      };
    });
    const ds = {
      version: 4,
      meta: {
        files: S.files, warnings: W, T0, rawPoints: rawCount, points: N, visits: nV, acts: nA, places: places.length,
        hasActs: nA > 0, inferredStays, inferredModes: nA === 0, importedAt: Date.now(), ms: Date.now() - t0Clock,
        day0, nDays: nD, dup,
      },
      pts: { t, la, lo, w, off, c: pc, ci: pci, dh, alt, air },
      segs: {
        pos: new Float32Array(segPos), ts: new Float32Array(segTs), start: new Uint32Array(segStart),
        mode: new Uint8Array(segMode), c: new Int16Array(segC), t0: new Float64Array(segT0), t1: new Float64Array(segT1),
        km: new Float32Array(segKm), inf: new Uint8Array(segInf), c2: new Int16Array(segC2),
      },
      visits: { s: vS, e: vE, off: vOff, p: vP, c: vC, ci: vCi },
      acts: { s: aS, e: aE, off: aOff, mode: aMode, km: aKm, c: aC, c2: aC2, la1: aLa1, lo1: aLo1, la2: aLa2, lo2: aLo2, ci1: aCi1, ci2: aCi2, inf: aInf },
      places: placesOut,
      cities: cityList,
      days: { day0, n: nD, kmMode, minMode, pts: dPts, maxHome, off: dOff, hourMove },
      dayCountry: { d: dcD, c: dcC, min: dcMin, km: dcKm },
      dayCity: { d: ciD, ci: ciC, min: ciMin },
      trips,
      homes: homes.map((h) => ({ mo: h.mo === -Infinity ? -1 : h.mo, la: h.la, lo: h.lo })),
    };
    return ds;
  }

  function transferables(ds) {
    const out = [];
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (ArrayBuffer.isView(o)) { if (!out.includes(o.buffer)) out.push(o.buffer); return; }
      if (Array.isArray(o)) return;
      for (const k of Object.keys(o)) walk(o[k]);
    };
    walk(ds);
    return out;
  }

  self.onmessage = async (ev) => {
    const msg = ev.data;
    try {
      if (msg.type === 'init') {
        decodeGeo(msg.countries, msg.cities);
        self.postMessage({ type: 'ready' });
        return;
      }
      if (msg.type === 'import') {
        S = newState();
        const files = msg.files;
        S.totalBytes = files.reduce((a, f) => a + f.size, 0) || 1;
        let base = 0;
        for (const f of files) {
          await importFile(f, base);
          base += f.size;
        }
        progress('read', 1, 'Lectura completada', true);
        for (const f of S.files) {
          if (f.truncated) S.warnings.push(f.name + ' parece incompleto (cortado al final); se ha leído lo que había');
          if (f.bad > 0) S.warnings.push(f.name + ': ' + pl(f.bad, 'fragmento ilegible ignorado', 'fragmentos ilegibles ignorados'));
        }
        const ds = analyze();
        S = null;
        self.postMessage({ type: 'done', ds }, transferables(ds));
      }
    } catch (err) {
      S = null;
      self.postMessage({ type: 'error', msg: (err && err.message) || String(err) });
    }
  };
}
