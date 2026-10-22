/* Huellas · datos de demostración.
 * Genera dos años de vida inventada (Barcelona, rutina de trabajo, piscina, escapadas y viajes a Roma,
 * Tokio, Nueva York…) en el MISMO formato que exporta la Cronología de Android, así la demo pasa por el
 * lector real exactamente igual que tu archivo. */
(function () {
  'use strict';
  const H = (window.H = window.H || {});

  H.makeDemoFile = function () {
    let seed = 20241022;
    const rnd = () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const between = (a, b) => a + (b - a) * rnd();
    const chance = (p) => rnd() < p;
    const MIN = 60000, HOUR = 3600000, DAY = 86400000;
    const R = 6371008.8, RAD = Math.PI / 180;
    const hav = (a, b) => {
      const dLa = (b.lat - a.lat) * RAD, dLo = (b.lon - a.lon) * RAD;
      const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLo / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };

    // husos con su horario de verano
    const lastSunday = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0)); return Date.UTC(y, m, d.getUTCDate() - d.getUTCDay()); };
    const nthSunday = (y, m, n) => { const d = new Date(Date.UTC(y, m, 1)); return Date.UTC(y, m, 1 + ((7 - d.getUTCDay()) % 7) + 7 * (n - 1)); };
    const TZ = {
      eu: (ms) => { const y = new Date(ms).getUTCFullYear(); return ms >= lastSunday(y, 2) + HOUR && ms < lastSunday(y, 9) + HOUR ? 120 : 60; },
      uk: (ms) => { const y = new Date(ms).getUTCFullYear(); return ms >= lastSunday(y, 2) + HOUR && ms < lastSunday(y, 9) + HOUR ? 60 : 0; },
      us: (ms) => { const y = new Date(ms).getUTCFullYear(); return ms >= nthSunday(y, 2, 2) + 7 * HOUR && ms < nthSunday(y, 10, 1) + 6 * HOUR ? -240 : -300; },
      jp: () => 540,
    };
    TZ.pt = TZ.uk;

    let pidN = 0;
    const pid = () => {
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
      let s = 'ChIJ';
      for (let i = 0; i < 23; i++) s += abc[Math.floor(rnd() * abc.length)];
      pidN++;
      return s;
    };
    const P = (lat, lon, tz, type) => ({ lat, lon, tz: tz || 'eu', type: type || 'UNKNOWN', id: pid() });
    const around = (c, km, tz) => {
      const a = rnd() * 2 * Math.PI, r = Math.sqrt(rnd()) * km * 1000;
      return P(c.lat + (r * Math.cos(a)) / 111320, c.lon + (r * Math.sin(a)) / (111320 * Math.cos(c.lat * RAD)), tz || c.tz);
    };

    // ---- lugares
    const home = P(41.39175, 2.16492, 'eu', 'HOME');
    const work = P(41.40363, 2.19461, 'eu', 'WORK');
    const pool = P(41.38598, 2.12807);
    const gym = P(41.39760, 2.15890);
    const market = P(41.39290, 2.16100);
    const beach = P(41.37950, 2.19270);
    const montjuic = P(41.36400, 2.15860);
    const tibidabo = P(41.42190, 2.11860);
    const parents = P(41.54795, 2.10741);
    const friends = [P(41.40360, 2.15440), P(41.38180, 2.17720), P(41.37560, 2.14880), P(41.41210, 2.17690)];
    const center = { lat: 41.3874, lon: 2.1686, tz: 'eu' };
    const restaurants = Array.from({ length: 14 }, () => around(center, 2.6));
    const lunchSpots = Array.from({ length: 6 }, () => around(work, 0.7));
    const airportBCN = P(41.29740, 2.08330);
    const sants = P(41.37920, 2.14000);
    const portBCN = P(41.37500, 2.17700);
    const dayTrips = [
      { p: P(41.59330, 1.83750), mode: 'IN_PASSENGER_VEHICLE', name: 'Montserrat' },
      { p: P(41.23500, 1.81100), mode: 'IN_TRAIN', name: 'Sitges' },
      { p: P(41.98390, 2.82380), mode: 'IN_TRAIN', name: 'Girona' },
      { p: P(41.71960, 2.93270), mode: 'IN_PASSENGER_VEHICLE', name: 'Tossa de Mar' },
      { p: P(41.11890, 1.24450), mode: 'IN_TRAIN', name: 'Tarragona' },
      { p: P(42.26480, 3.17880), mode: 'IN_PASSENGER_VEHICLE', name: 'Cadaqués' },
    ];

    const segs = [];
    const raw = [];
    let cur = { p: home, t: 0 };

    const pad = (n, l) => String(Math.floor(n)).padStart(l || 2, '0');
    const iso = (ms, tz) => {
      const off = TZ[tz](ms);
      const d = new Date(ms + off * MIN);
      const a = Math.abs(off);
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' +
        pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + '.000' + (off >= 0 ? '+' : '-') + pad(a / 60) + ':' + pad(a % 60);
    };
    const ll = (q) => q.lat.toFixed(7) + '°, ' + q.lon.toFixed(7) + '°';
    // instante UTC de una hora local en el huso del lugar
    const at = (dayLocal, h, tz) => { const loc = dayLocal + h * HOUR; return loc - TZ[tz](loc - HOUR) * MIN; };

    function stayUntil(t1) {
      if (t1 <= cur.t + MIN) return;
      segs.push({
        startTime: iso(cur.t, cur.p.tz), endTime: iso(t1, cur.p.tz),
        startTimeTimezoneUtcOffsetMinutes: TZ[cur.p.tz](cur.t), endTimeTimezoneUtcOffsetMinutes: TZ[cur.p.tz](t1),
        visit: {
          hierarchyLevel: 0, probability: +(0.7 + rnd() * 0.29).toFixed(4),
          topCandidate: { placeId: cur.p.id, semanticType: cur.p.type, probability: +(0.6 + rnd() * 0.39).toFixed(4), placeLocation: { latLng: ll(cur.p) } },
        },
      });
      cur.t = t1;
    }

    const SPEED = { WALKING: 1.35, RUNNING: 2.8, CYCLING: 4.6, IN_SUBWAY: 8.5, IN_BUS: 6.5, IN_TRAM: 5.5, IN_TRAIN: 24, IN_PASSENGER_VEHICLE: 13, FLYING: 230, IN_FERRY: 9 };
    // Las rutas se recuerdan por pareja de lugares: como en la vida real, repites los mismos caminos.
    const routeCache = new Map();
    function route(a, b, mode) {
      if (mode === 'FLYING') return [a, b];
      const group = mode === 'WALKING' || mode === 'RUNNING' || mode === 'CYCLING' ? 'slow' : mode;
      const key = a.lat.toFixed(4) + a.lon.toFixed(4) + '>' + b.lat.toFixed(4) + b.lon.toFixed(4) + group;
      let base = routeCache.get(key);
      if (!base) {
        base = hav(a, b) < 9000 && mode !== 'IN_TRAIN' && mode !== 'IN_FERRY' ? gridRoute(a, b) : curveRoute(a, b, mode);
        routeCache.set(key, base);
      }
      const j = mode === 'WALKING' || mode === 'RUNNING' ? 0.00004 : 0.00008;
      return base.map((q, i) => (i === 0 || i === base.length - 1 ? q : { lat: q.lat + j * (rnd() - 0.5), lon: q.lon + j * (rnd() - 0.5) }));
    }
    // ciudad: calles en cuadrícula girada 45° (como el Eixample), en escalera de 2–4 tramos
    function gridRoute(a, b) {
      const k = Math.cos(a.lat * RAD), ang = 44 * RAD;
      const toUV = (q) => { const x = (q.lon - a.lon) * 111320 * k, y = (q.lat - a.lat) * 110540; return [x * Math.cos(ang) + y * Math.sin(ang), -x * Math.sin(ang) + y * Math.cos(ang)]; };
      const toLL = (u, v) => { const x = u * Math.cos(ang) - v * Math.sin(ang), y = u * Math.sin(ang) + v * Math.cos(ang); return { lat: a.lat + y / 110540, lon: a.lon + x / (111320 * k) }; };
      const [U, V] = toUV(b);
      const steps = 2 + Math.floor(rnd() * 3);
      const corners = [[0, 0]];
      let u = 0, v = 0;
      for (let s = 1; s <= steps; s++) {
        const nu = s === steps ? U : U * (s / steps) + (rnd() - 0.5) * Math.abs(U) * 0.25;
        corners.push([nu, v]); u = nu;
        const nv = s === steps ? V : V * (s / steps) + (rnd() - 0.5) * Math.abs(V) * 0.25;
        corners.push([u, nv]); v = nv;
      }
      const out = [];
      for (let c = 1; c < corners.length; c++) {
        const [u0, v0] = corners[c - 1], [u1, v1] = corners[c];
        const len = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.round(len / 160));
        for (let i = c === 1 ? 0 : 1; i <= n; i++) out.push(toLL(u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * i) / n));
      }
      out[out.length - 1] = { lat: b.lat, lon: b.lon };
      return out;
    }
    function curveRoute(a, b, mode) {
      const d = hav(a, b);
      const step = mode === 'WALKING' || mode === 'RUNNING' ? 180 : mode === 'CYCLING' ? 320 : d > 40000 ? 3500 : 700;
      const n = Math.max(2, Math.min(160, Math.round(d / step)));
      // curva suave hacia un lado (perpendicular al trayecto) + una ondulación y un poco de ruido de GPS
      const k = Math.cos(a.lat * RAD);
      const dLat = b.lat - a.lat, dLonS = (b.lon - a.lon) * k;
      const bend = (rnd() - 0.5) * 0.24, wave = (rnd() - 0.5) * 0.06, ph = rnd() * 6;
      const out = [];
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const off = Math.sin(Math.PI * f) * bend + Math.sin(f * 9 + ph) * wave * Math.sin(Math.PI * f);
        const j = i === 0 || i === n ? 0 : mode === 'WALKING' || mode === 'RUNNING' ? 0.00008 : 0.0002;
        out.push({
          lat: a.lat + dLat * f - dLonS * off + j * (rnd() - 0.5),
          lon: a.lon + (dLonS * f + dLat * off) / k + j * (rnd() - 0.5),
        });
      }
      return out;
    }
    function go(dest, mode, minutes) {
      const pts = route(cur.p, dest, mode);
      let dist = 0;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) { dist += hav(pts[i - 1], pts[i]); cum.push(dist); }
      const overhead = mode === 'FLYING' ? 25 * MIN : mode === 'IN_TRAIN' || mode === 'IN_SUBWAY' ? 6 * MIN : 2 * MIN;
      const dur = minutes ? minutes * MIN : (dist / SPEED[mode]) * 1000 * between(0.9, 1.25) + overhead;
      const t0 = cur.t, t1 = t0 + dur;
      const tz = cur.p.tz;
      segs.push({
        startTime: iso(t0, tz), endTime: iso(t1, dest.tz),
        startTimeTimezoneUtcOffsetMinutes: TZ[tz](t0), endTimeTimezoneUtcOffsetMinutes: TZ[dest.tz](t1),
        activity: {
          start: { latLng: ll(cur.p) }, end: { latLng: ll(dest) },
          distanceMeters: +(mode === 'FLYING' ? hav(cur.p, dest) : dist).toFixed(1),
          probability: +(0.8 + rnd() * 0.19).toFixed(4),
          topCandidate: { type: mode, probability: +(0.6 + rnd() * 0.39).toFixed(4) },
        },
      });
      if (mode !== 'FLYING') {
        segs.push({
          startTime: iso(t0, tz), endTime: iso(t1, dest.tz),
          timelinePath: pts.map((q, i) => ({ point: ll(q), time: iso(t0 + (dur * cum[i]) / Math.max(1, dist), i < pts.length / 2 ? tz : dest.tz) })),
        });
      }
      cur = { p: dest, t: t1 };
    }
    const commuteMode = () => pick(['IN_SUBWAY', 'IN_SUBWAY', 'IN_SUBWAY', 'CYCLING', 'CYCLING', 'WALKING', 'IN_BUS']);

    // ---- un día normal
    function weekday(day) {
      const tz = 'eu';
      stayUntil(at(day, between(7.6, 8.7), tz));
      go(work, commuteMode());
      if (chance(0.35)) {
        stayUntil(at(day, between(13.3, 14), tz));
        go(pick(lunchSpots), 'WALKING');
        stayUntil(cur.t + between(40, 70) * MIN);
        go(work, 'WALKING');
      }
      stayUntil(at(day, between(17.6, 19), tz));
      const wd = new Date(day).getUTCDay();
      if ((wd === 1 || wd === 3 || wd === 5) && chance(0.8)) {
        const p = chance(0.75) ? pool : gym;
        go(p, chance(0.6) ? 'CYCLING' : 'IN_SUBWAY');
        stayUntil(cur.t + between(55, 95) * MIN);
        go(home, chance(0.5) ? 'CYCLING' : 'WALKING');
      } else go(home, commuteMode());
      if (chance(0.22)) {
        stayUntil(at(day, between(20.3, 21.2), tz));
        go(chance(0.6) ? pick(restaurants) : pick(friends), chance(0.5) ? 'WALKING' : 'IN_SUBWAY');
        stayUntil(cur.t + between(90, 170) * MIN);
        go(home, chance(0.4) ? 'IN_PASSENGER_VEHICLE' : 'WALKING');
      }
    }
    function weekend(day) {
      const tz = 'eu';
      const wd = new Date(day).getUTCDay();
      stayUntil(at(day, between(9.8, 11.5), tz));
      if (wd === 0 && chance(0.4)) {
        go(parents, chance(0.6) ? 'IN_PASSENGER_VEHICLE' : 'IN_TRAIN');
        stayUntil(at(day, between(17, 19.5), tz));
        go(home, 'IN_PASSENGER_VEHICLE');
        return;
      }
      if (chance(0.22)) {
        const dt = pick(dayTrips);
        go(dt.mode === 'IN_TRAIN' ? sants : home, 'WALKING');
        go(dt.p, dt.mode);
        for (let k = 0; k < 3; k++) { stayUntil(cur.t + between(40, 110) * MIN); go(around(dt.p, 1.2), 'WALKING'); }
        stayUntil(at(day, between(18, 20), tz));
        go(dt.mode === 'IN_TRAIN' ? sants : home, dt.mode);
        if (cur.p !== home) go(home, 'IN_SUBWAY');
        return;
      }
      go(market, 'WALKING');
      stayUntil(cur.t + between(25, 50) * MIN);
      go(home, 'WALKING');
      stayUntil(at(day, between(16, 17.5), tz));
      const plan = pick([beach, montjuic, tibidabo, pick(friends), pick(restaurants)]);
      go(plan, plan === tibidabo ? 'IN_BUS' : plan === beach ? 'CYCLING' : chance(0.5) ? 'WALKING' : 'IN_SUBWAY');
      if (plan === montjuic || plan === tibidabo) { stayUntil(cur.t + between(30, 60) * MIN); go(around(plan, 1), 'RUNNING'); }
      stayUntil(cur.t + between(80, 180) * MIN);
      go(home, chance(0.5) ? 'IN_SUBWAY' : 'WALKING');
    }

    // ---- viajes de varios días
    function cityDays(c, nDays, startDay, opts) {
      opts = opts || {};
      const hotel = opts.hotel || around(c, 1.2);
      const pois = Array.from({ length: 10 }, () => around(c, opts.r || 3.2));
      for (let k = 0; k < nDays; k++) {
        const day = startDay + k * DAY;
        if (k > 0 || cur.p !== hotel) { if (cur.p !== hotel) go(hotel, 'IN_PASSENGER_VEHICLE'); }
        stayUntil(Math.max(cur.t + 20 * MIN, at(day, between(9, 10.5), c.tz)));
        const n = 3 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
          go(pick(pois), chance(0.7) ? 'WALKING' : opts.transit || 'IN_SUBWAY');
          stayUntil(cur.t + between(45, 140) * MIN);
        }
        go(hotel, chance(0.6) ? 'WALKING' : opts.transit || 'IN_SUBWAY');
        if (k < nDays - 1) stayUntil(at(day + DAY, between(8.5, 9.5), c.tz));
      }
      return hotel;
    }
    function fly(fromAirport, toAirport, toCity) {
      go(fromAirport, cur.p === home ? 'IN_PASSENGER_VEHICLE' : 'IN_PASSENGER_VEHICLE');
      stayUntil(cur.t + between(80, 120) * MIN);
      go(toAirport, 'FLYING');
      stayUntil(cur.t + between(25, 50) * MIN);
      if (toCity) go(toCity, 'IN_PASSENGER_VEHICLE');
    }
    const C = (lat, lon, tz) => ({ lat, lon, tz });
    const trips = [
      { start: '2024-10-11', days: 4, run(d) { const rome = C(41.9028, 12.4964, 'eu'); stayUntil(at(d, 7, 'eu')); fly(airportBCN, P(41.8003, 12.2389), null); const h = around(rome, 1); go(h, 'IN_TRAIN'); cityDays(rome, 4, d, { hotel: h }); stayUntil(at(d + 3 * DAY, 16, 'eu')); fly(P(41.8003, 12.2389), airportBCN, home); } },
      { start: '2024-12-06', days: 3, run(d) { const andorra = C(42.5063, 1.5218, 'eu'); stayUntil(at(d, 9, 'eu')); const h = around(andorra, 0.6); go(h, 'IN_PASSENGER_VEHICLE'); cityDays(andorra, 3, d, { hotel: h, r: 6, transit: 'IN_PASSENGER_VEHICLE' }); stayUntil(at(d + 2 * DAY, 15, 'eu')); go(home, 'IN_PASSENGER_VEHICLE'); } },
      { start: '2025-02-14', days: 3, run(d) { const lon = C(51.5074, -0.1278, 'uk'); const lhr = P(51.4700, -0.4543, 'uk'); stayUntil(at(d, 6.5, 'eu')); fly(airportBCN, lhr, null); const h = around(lon, 2); go(h, 'IN_TRAIN'); cityDays(lon, 3, d, { hotel: h, r: 4 }); stayUntil(at(d + 2 * DAY, 15, 'uk')); go(lhr, 'IN_TRAIN'); stayUntil(cur.t + 100 * MIN); go(airportBCN, 'FLYING'); stayUntil(cur.t + 30 * MIN); go(home, 'IN_PASSENGER_VEHICLE'); } },
      { start: '2025-04-17', days: 5, run(d) { const lis = C(38.7223, -9.1393, 'pt'), opo = C(41.1579, -8.6291, 'pt'); stayUntil(at(d, 8, 'eu')); fly(airportBCN, P(38.7742, -9.1342, 'pt'), null); const h = around(lis, 1); go(h, 'IN_SUBWAY'); cityDays(lis, 3, d, { hotel: h, transit: 'IN_TRAM' }); stayUntil(at(d + 3 * DAY, 9, 'pt')); go(P(38.7680, -9.0990, 'pt'), 'IN_SUBWAY'); const h2 = around(opo, 0.8); go(P(41.1489, -8.5856, 'pt'), 'IN_TRAIN'); go(h2, 'IN_PASSENGER_VEHICLE'); cityDays(opo, 2, d + 3 * DAY, { hotel: h2, transit: 'IN_BUS' }); stayUntil(at(d + 4 * DAY, 17, 'pt')); fly(P(41.2481, -8.6814, 'pt'), airportBCN, home); } },
      { start: '2025-06-07', days: 5, run(d) { const stops = [C(42.6887, 2.8948, 'eu'), C(43.6108, 3.8767, 'eu'), C(43.8367, 4.3601, 'eu'), C(43.9493, 4.8055, 'eu')]; stayUntil(at(d, 9, 'eu')); stops.forEach((c, i) => { const h = around(c, 0.8); go(h, 'IN_PASSENGER_VEHICLE'); cityDays(c, 1, d + i * DAY, { hotel: h, r: 2 }); if (i < stops.length - 1) stayUntil(at(d + (i + 1) * DAY, 10, 'eu')); }); stayUntil(at(d + 4 * DAY, 10, 'eu')); go(home, 'IN_PASSENGER_VEHICLE'); } },
      { start: '2025-08-02', days: 11, run(d) { const tky = C(35.6762, 139.6503, 'jp'), kyo = C(35.0116, 135.7681, 'jp'), osa = C(34.6937, 135.5023, 'jp'); stayUntil(at(d, 9, 'eu')); fly(airportBCN, P(35.5494, 139.7798, 'jp'), null); const h = around(tky, 2); go(h, 'IN_TRAIN'); cityDays(tky, 5, d + DAY, { hotel: h, r: 6 }); stayUntil(at(d + 5 * DAY, 10, 'jp')); go(P(35.6812, 139.7671, 'jp'), 'IN_SUBWAY'); const h2 = around(kyo, 1.5); go(P(34.9858, 135.7588, 'jp'), 'IN_TRAIN'); go(h2, 'IN_BUS'); cityDays(kyo, 3, d + 5 * DAY, { hotel: h2, transit: 'IN_BUS' }); stayUntil(at(d + 8 * DAY, 10, 'jp')); const h3 = around(osa, 1.5); go(h3, 'IN_TRAIN'); cityDays(osa, 2, d + 8 * DAY, { hotel: h3 }); stayUntil(at(d + 10 * DAY, 8, 'jp')); fly(P(34.4320, 135.2304, 'jp'), airportBCN, home); } },
      { start: '2025-10-23', days: 3, run(d) { const mad = C(40.4168, -3.7038, 'eu'); stayUntil(at(d, 8, 'eu')); go(sants, 'IN_SUBWAY'); go(P(40.4065, -3.6895), 'IN_TRAIN'); const h = around(mad, 1.2); go(h, 'IN_SUBWAY'); cityDays(mad, 3, d, { hotel: h }); stayUntil(at(d + 2 * DAY, 17, 'eu')); go(P(40.4065, -3.6895), 'IN_SUBWAY'); go(sants, 'IN_TRAIN'); go(home, 'IN_SUBWAY'); } },
      { start: '2025-12-27', days: 7, run(d) { const ny = C(40.758, -73.9855, 'us'), jfk = P(40.6413, -73.7781, 'us'); stayUntil(at(d, 8, 'eu')); fly(airportBCN, jfk, null); const h = around(ny, 1.5); go(h, 'IN_PASSENGER_VEHICLE'); cityDays(ny, 6, d, { hotel: h, r: 5 }); stayUntil(at(d + 6 * DAY, 15, 'us')); fly(jfk, airportBCN, home); } },
      { start: '2026-03-19', days: 4, run(d) { const par = C(48.8566, 2.3522, 'eu'); stayUntil(at(d, 8, 'eu')); go(sants, 'IN_SUBWAY'); go(P(48.8443, 2.3744), 'IN_TRAIN'); const h = around(par, 1.5); go(h, 'IN_SUBWAY'); cityDays(par, 4, d, { hotel: h, r: 4 }); stayUntil(at(d + 3 * DAY, 15, 'eu')); go(P(48.8443, 2.3744), 'IN_SUBWAY'); go(sants, 'IN_TRAIN'); go(home, 'IN_PASSENGER_VEHICLE'); } },
      { start: '2026-07-10', days: 5, run(d) { const pal = C(39.5696, 2.6502, 'eu'); stayUntil(at(d, 8, 'eu')); go(portBCN, 'IN_PASSENGER_VEHICLE'); stayUntil(cur.t + 60 * MIN); go(P(39.5550, 2.6300), 'IN_FERRY'); const h = around(pal, 1.5); go(h, 'IN_PASSENGER_VEHICLE'); cityDays(pal, 5, d, { hotel: h, r: 12, transit: 'IN_PASSENGER_VEHICLE' }); stayUntil(at(d + 4 * DAY, 17, 'eu')); go(P(39.5550, 2.6300), 'IN_PASSENGER_VEHICLE'); go(portBCN, 'IN_FERRY'); go(home, 'IN_PASSENGER_VEHICLE'); } },
    ];
    const tripByDay = new Map(trips.map((t) => [Date.parse(t.start + 'T00:00:00Z'), t]));

    const start = Date.parse('2024-09-02T00:00:00Z'), end = Date.parse('2026-09-30T00:00:00Z');
    cur = { p: home, t: at(start, 0, 'eu') };
    for (let day = start; day <= end; day += DAY) {
      const trip = tripByDay.get(day);
      if (trip) { trip.run(day); day += (trip.days - 1) * DAY; continue; }
      if (chance(0.012)) { // día sin datos (móvil apagado o sin batería)
        cur.t = at(day + DAY, 7, 'eu');
        continue;
      }
      const wd = new Date(day).getUTCDay();
      if (wd === 0 || wd === 6 || (new Date(day).getUTCMonth() === 7 && chance(0.6))) weekend(day); else weekday(day);
    }
    stayUntil(at(end + DAY, 8, 'eu'));

    // unas pocas señales «crudas» del final, como en la exportación real
    for (let k = 0; k < 400; k++) {
      const tt = cur.t - k * 9 * MIN;
      raw.push({ position: { LatLng: ll(around(home, 0.05)), accuracyMeters: 8 + Math.round(rnd() * 30), altitudeMeters: 40 + rnd() * 10, source: 'WIFI', timestamp: iso(tt, 'eu'), speedMetersPerSecond: 0 } });
      if (k % 25 === 0) raw.push({ wifiScan: { deliveryTime: iso(tt, 'eu'), devicesRecords: [{ mac: 123456789, rawRssi: -60 }] } });
    }

    const json = JSON.stringify({
      semanticSegments: segs,
      rawSignals: raw,
      userLocationProfile: {
        frequentPlaces: [
          { placeId: home.id, placeLocation: ll(home), label: 'HOME' },
          { placeId: work.id, placeLocation: ll(work), label: 'WORK' },
        ],
        persona: { travelModeAffinities: [{ mode: 'WALKING', affinity: 0.6 }, { mode: 'IN_SUBWAY', affinity: 0.3 }] },
      },
    });
    return new File([json], 'Timeline (demo).json', { type: 'application/json' });
  };
})();
