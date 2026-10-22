/* Pruebas del lector: cada formato, casos rotos y un archivo gigante. Abrir tests/index.html. */
(function () {
  'use strict';
  const engine = new H.Engine();
  const C = window.HUELLAS_COUNTRIES;
  const isoOf = (i) => (i >= 0 && C[i] ? C[i].iso : '');
  const countriesOf = (ds) => Array.from(new Set(Array.from(ds.dayCountry.c).map(isoOf))).filter(Boolean).sort();
  const totalKm = (ds) => ds.days.kmMode.reduce((a, b) => a + b, 0);
  const file = (txt, name, type) => new File([txt], name, { type: type || 'application/json' });

  function assert(cond, msg) { if (!cond) throw new Error(msg); }

  // ------------------------------------------------------------- fixtures
  const ANDROID = JSON.stringify({
    semanticSegments: [
      { startTime: '2025-03-01T08:00:00.000+01:00', endTime: '2025-03-01T09:00:00.000+01:00', startTimeTimezoneUtcOffsetMinutes: 60, endTimeTimezoneUtcOffsetMinutes: 60, visit: { hierarchyLevel: 0, probability: 0.9, topCandidate: { placeId: 'ChIJhome', semanticType: 'HOME', probability: 0.9, placeLocation: { latLng: '41.3917500°, 2.1649200°' } } } },
      { startTime: '2025-03-01T09:00:00.000+01:00', endTime: '2025-03-01T09:30:00.000+01:00', activity: { start: { latLng: '41.3917500°, 2.1649200°' }, end: { latLng: '41.4036300°, 2.1946100°' }, distanceMeters: 3100, topCandidate: { type: 'IN_SUBWAY', probability: 0.9 } } },
      { startTime: '2025-03-01T09:00:00.000+01:00', endTime: '2025-03-01T11:00:00.000+01:00', timelinePath: [{ point: '41.39175°, 2.16492°', time: '2025-03-01T09:00:00.000+01:00' }, { point: '41.3960°, 2.1750°', time: '2025-03-01T09:10:00.000+01:00' }, { point: '41.4000°, 2.1850°', time: '2025-03-01T09:20:00.000+01:00' }, { point: '41.40363°, 2.19461°', time: '2025-03-01T09:30:00.000+01:00' }] },
      { startTime: '2025-03-01T09:30:00.000+01:00', endTime: '2025-03-01T18:00:00.000+01:00', visit: { hierarchyLevel: 0, topCandidate: { placeId: 'ChIJwork', semanticType: 'WORK', placeLocation: { latLng: '41.4036300°, 2.1946100°' } } } },
      { startTime: '2025-03-01T18:00:00.000+01:00', endTime: '2025-03-01T18:40:00.000+01:00', activity: { start: { latLng: '41.4036300°, 2.1946100°' }, end: { latLng: '41.3917500°, 2.1649200°' }, distanceMeters: 3300, topCandidate: { type: 'WALKING' } } },
      { startTime: '2025-03-01T18:40:00.000+01:00', endTime: '2025-03-02T08:00:00.000+01:00', visit: { topCandidate: { placeId: 'ChIJhome', semanticType: 'HOME', placeLocation: { latLng: '41.3917500°, 2.1649200°' } } } },
      { startTime: '2025-03-01T10:00:00.000+01:00', endTime: '2025-03-01T12:00:00.000+01:00', timelineMemory: { trip: { distanceFromOriginKms: 0 } } },
    ],
    rawSignals: [
      { position: { LatLng: '41.39176°, 2.16493°', accuracyMeters: 12, altitudeMeters: 45.2, source: 'WIFI', timestamp: '2025-03-01T20:00:00.000+01:00', speedMetersPerSecond: 0 } },
      { wifiScan: { deliveryTime: '2025-03-01T20:00:00.000+01:00', devicesRecords: [] } },
      { activityRecord: { probableActivities: [{ type: 'STILL', confidence: 0.9 }], timestamp: '2025-03-01T20:00:00.000+01:00' } },
    ],
    userLocationProfile: { frequentPlaces: [{ placeId: 'ChIJhome', placeLocation: '41.3917500°, 2.1649200°', label: 'HOME' }] },
  }, null, 2);

  const IOS = JSON.stringify([
    { endTime: '2025-07-07T14:45:10.000-04:00', startTime: '2025-07-07T13:30:00.000-04:00', visit: { hierarchyLevel: '0', topCandidate: { placeID: 'ChIJmQJIxlVYwokRLgeuocVOGVU', semanticType: 'Unknown', placeLocation: 'geo:40.758895,-73.985131', probability: '0.95' }, probability: '0.95' } },
    { endTime: '2025-07-07T15:00:25.000-04:00', startTime: '2025-07-07T14:45:10.000-04:00', activity: { start: 'geo:40.758895,-73.985131', end: 'geo:40.754738,-73.983793', distanceMeters: '550.0', topCandidate: { type: 'walking', probability: '0.92' } } },
    { endTime: '2025-07-07T15:18:00.000-04:00', startTime: '2025-07-07T15:00:25.000-04:00', visit: { hierarchyLevel: '1', topCandidate: { placeID: 'ChIJnaaBxlVYwokR82p8p0So1dM', placeLocation: 'geo:40.754738,-73.983793', probability: '0.88' }, probability: '0.88' } },
    { endTime: '2025-07-07T15:40:50.000-04:00', startTime: '2025-07-07T15:18:00.000-04:00', activity: { start: 'geo:40.754738,-73.983793', end: 'geo:40.735914,-73.990334', distanceMeters: '2400.0', topCandidate: { type: 'in subway', probability: '0.85' } } },
    { endTime: '2025-07-07T15:46:15.000-04:00', startTime: '2025-07-07T15:40:50.000-04:00', activity: { start: 'geo:40.735914,-73.990334', end: 'geo:40.734810,-73.991240', distanceMeters: '150.0', topCandidate: { type: 'walking', probability: '0.95' } } },
    { endTime: '2025-07-07T16:30:00.000-04:00', startTime: '2025-07-07T15:46:15.000-04:00', visit: { hierarchyLevel: '0', topCandidate: { placeID: 'ChIJ9_x2DGBZwokR7sBgx-zlsb8', semanticType: 'Inferred Home', placeLocation: 'geo:40.734810,-73.991240', probability: '0.94' }, probability: '0.94' } },
    { startTime: '2025-07-07T14:45:10.000-04:00', endTime: '2025-07-07T15:46:15.000-04:00', timelinePath: [
      { point: 'geo:40.758895,-73.985131', durationMinutesOffsetFromStartTime: '0' }, { point: 'geo:40.757950,-73.985830', durationMinutesOffsetFromStartTime: '4' },
      { point: 'geo:40.756830,-73.986600', durationMinutesOffsetFromStartTime: '8' }, { point: 'geo:40.754738,-73.983793', durationMinutesOffsetFromStartTime: '15' },
      { point: 'geo:40.748440,-73.985664', durationMinutesOffsetFromStartTime: '40' }, { point: 'geo:40.735914,-73.990334', durationMinutesOffsetFromStartTime: '55' },
      { point: 'geo:40.734810,-73.991240', durationMinutesOffsetFromStartTime: '61' }] },
    { startTime: '2025-07-07T10:00:00.000-04:00', endTime: '2025-07-07T12:00:00.000-04:00', timelineMemory: { destinations: [{ identifier: 'ChIJ' }], distanceFromOriginKms: '5' } },
  ]);

  const SEMANTIC = JSON.stringify({ timelineObjects: [
    { placeVisit: { location: { latitudeE7: 407588950, longitudeE7: -739851310, placeId: 'ChIJmQJIxlVYwokRLgeuocVOGVU', name: 'Times Square', address: 'Manhattan, NY 10036', semanticType: 'TYPE_SEARCHED_ADDRESS' }, duration: { startTimestamp: '2025-07-07T17:30:00Z', endTimestamp: '2025-07-07T18:45:10Z' }, placeConfidence: 'HIGH_CONFIDENCE' } },
    { activitySegment: { startLocation: { latitudeE7: 407588950, longitudeE7: -739851310 }, endLocation: { latitudeE7: 407547380, longitudeE7: -739837930 }, duration: { startTimestamp: '2025-07-07T18:45:10Z', endTimestamp: '2025-07-07T19:00:25Z' }, distance: 550, activityType: 'WALKING', waypointPath: { waypoints: [{ latE7: 407579500, lngE7: -739858300 }, { latE7: 407568300, lngE7: -739866000 }] } } },
    { placeVisit: { location: { latitudeE7: 407547380, longitudeE7: -739837930, placeId: 'ChIJnaaBxlVYwokR82p8p0So1dM', name: "Macy's" }, duration: { startTimestampMs: '1751915425000', endTimestampMs: '1751916480000' } } },
    { activitySegment: { startLocation: { latitudeE7: 407547380, longitudeE7: -739837930 }, endLocation: { latitudeE7: 407359140, longitudeE7: -739903340 }, duration: { startTimestamp: '2025-07-07T19:18:00Z', endTimestamp: '2025-07-07T19:40:50Z' }, distance: 2400, activityType: 'IN_SUBWAY', simplifiedRawPath: { points: [{ latE7: 407484400, lngE7: -739856640, accuracyMeters: 10, timestamp: '2025-07-07T19:30:00Z' }] } } },
    { activitySegment: { startLocation: { latitudeE7: 407359140, longitudeE7: -739903340 }, endLocation: { latitudeE7: 407348100, lngE7: -739912400 }, duration: { startTimestamp: '2025-07-07T19:40:50Z', endTimestamp: '2025-07-07T19:46:15Z' }, distance: 150, activityType: 'WALKING' } },
    { placeVisit: { location: { latitudeE7: 407348100, longitudeE7: -739912400, placeId: 'ChIJ9_x2DGBZwokR7sBgx-zlsb8', name: 'Washington Square Park' }, duration: { startTimestamp: '2025-07-07T19:46:15Z', endTimestamp: '2025-07-07T20:30:00Z' }, childVisits: [{ location: { latitudeE7: 407348100, longitudeE7: -739912400, name: 'Arco' } }] } },
  ] });

  function recordsText(n, opts) {
    opts = opts || {};
    const out = [];
    const t0 = Date.UTC(2024, 6, 3, 13, 0, 0);
    for (let i = 0; i < n; i++) {
      const lat = 40.758 - i * 0.0004, lon = -73.9855 + Math.sin(i / 20) * 0.0012;
      const r = { latitudeE7: Math.round(lat * 1e7), longitudeE7: Math.round(lon * 1e7), accuracy: 12 + (i % 7), source: 'GPS', deviceTag: 1 };
      if (i % 3 === 0) r.timestampMs = String(t0 + i * 30000); else r.timestamp = new Date(t0 + i * 30000).toISOString();
      if (i === 5) r.longitudeE7 = r.longitudeE7 + 4294967296; // valor desbordado de Takeout antiguo
      if (i === 40) { r.latitudeE7 = 488566000; r.longitudeE7 = 23522000; } // salto de GPS a París
      if (i === 60) r.accuracy = 5000;
      if (i === 70) { delete r.latitudeE7; }
      if (i % 50 === 49) r.activity = [{ activity: [{ type: 'WALKING', confidence: 80 }], timestamp: r.timestamp || '' }];
      out.push(r);
      if (i === 80) out.push(Object.assign({}, r)); // duplicado exacto
    }
    return JSON.stringify({ locations: out });
  }

  const GPX = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    '<wpt lat="40.4168" lon="-3.7038"><time>2024-05-10T08:00:00Z</time><name>Puerta del Sol</name></wpt>\n<trk><name>Paseo</name><trkseg>\n' +
    Array.from({ length: 60 }, (_, i) => '<trkpt lat="' + (40.4168 + i * 0.0003).toFixed(6) + '" lon="' + (-3.7038 + i * 0.0002).toFixed(6) + '"><ele>' + (650 + i) + '</ele><time>' + new Date(Date.UTC(2024, 4, 10, 9, 0, 0) + i * 20000).toISOString() + '</time></trkpt>').join('\n') +
    '\n</trkseg></trk>\n</gpx>';

  const KML_TRACK = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark><open>1</open><gx:Track><altitudeMode>clampToGround</altitudeMode>' +
    Array.from({ length: 40 }, (_, i) => '<when>' + new Date(Date.UTC(2023, 8, 2, 10, 0, 0) + i * 45000).toISOString() + '</when><gx:coord>' + (2.3522 + i * 0.0004).toFixed(6) + ' ' + (48.8566 + i * 0.0002).toFixed(6) + ' 35</gx:coord>').join('') +
    '</gx:Track></Placemark></Document></kml>';

  const KML_DAY = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Location history from 2019-05-04 to 2019-05-04</name>' +
    '<Placemark><name>Museo del Louvre</name><address>Rue de Rivoli, 75001 Paris</address><ExtendedData><Data name="Category"><value></value></Data></ExtendedData><Point><coordinates>2.3376,48.8606,0</coordinates></Point><TimeSpan><begin>2019-05-04T08:00:00.000Z</begin><end>2019-05-04T11:30:00.000Z</end></TimeSpan></Placemark>' +
    '<Placemark><name>Walking</name><ExtendedData><Data name="Category"><value>Walking</value></Data><Data name="Distance"><value>1800</value></Data></ExtendedData><LineString><altitudeMode>clampToGround</altitudeMode><extrude>0</extrude><tesselate>1</tesselate><coordinates>2.3376,48.8606,0 2.3400,48.8580,0 2.3450,48.8560,0 2.3499,48.8530,0</coordinates></LineString><TimeSpan><begin>2019-05-04T11:30:00.000Z</begin><end>2019-05-04T12:00:00.000Z</end></TimeSpan></Placemark>' +
    '</Document></kml>';

  const CSV = 'fecha;latitud;longitud;precisión\n' + Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2024, 3, 1, 10, 0, 0) + i * 60000).toISOString() + ';' + (45.4642 + i * 0.0004).toFixed(5) + ';' + (9.19 + i * 0.0003).toFixed(5) + ';10').join('\n');

  function trickyAndroid(n) {
    const segs = [];
    const weird = ['Ch\\"I{J}[x]', 'back\\\\slash\\\\', 'llave } y corchete ]', 'unié ☃', '"', '\\', '}{][,:'];
    for (let i = 0; i < n; i++) {
      const s = Date.UTC(2023, 0, 1) + i * 2 * 3600000;
      segs.push({
        startTime: new Date(s).toISOString(), endTime: new Date(s + 3600000).toISOString(),
        visit: { hierarchyLevel: 0, topCandidate: { placeId: 'ChIJ' + (i % 40) + weird[i % weird.length], semanticType: i % 9 ? 'UNKNOWN' : 'HOME', name: weird[(i + 3) % weird.length].repeat(1 + (i % 13)), placeLocation: { latLng: (41.38 + (i % 40) * 0.001).toFixed(6) + '°, ' + (2.17 + (i % 40) * 0.001).toFixed(6) + '°' } } },
      });
    }
    return JSON.stringify({ semanticSegments: segs, rawSignals: [], userLocationProfile: { frequentPlaces: [] } }, null, 1);
  }

  // ------------------------------------------------------------- zip mínimo para las pruebas
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  async function makeZip(entries, name) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const raw = enc.encode(e.data);
      const crc = crc32(raw);
      let comp = raw, method = 0;
      if (e.deflate) { comp = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); method = 8; }
      const nm = enc.encode(e.name);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true); lh.setUint16(8, method, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, comp.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
      parts.push(lh, nm, comp);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x800, true); ch.setUint16(10, method, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, comp.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
      central.push(ch, nm);
      offset += 30 + nm.length + comp.length;
    }
    const cdSize = central.reduce((a, p) => a + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new File([...parts, ...central, end], name || 'takeout.zip', { type: 'application/zip' });
  }

  // ------------------------------------------------------------- casos
  const TESTS = [
    { name: 'Android · Timeline.json del móvil', files: () => [file(ANDROID, 'Timeline.json')], check(ds) {
      assert(ds.meta.visits === 3, 'visitas ' + ds.meta.visits);
      assert(ds.meta.acts === 2, 'actividades ' + ds.meta.acts);
      assert(countriesOf(ds).join() === 'ES', 'países ' + countriesOf(ds));
      assert(Math.abs(totalKm(ds) - 6.4) < 0.05, 'km ' + totalKm(ds));
      assert(ds.places.length === 2 && ds.places.some((p) => p.type === 'home') && ds.places.some((p) => p.type === 'work'), 'casa/trabajo');
      assert(ds.days.off[0] === 60, 'desfase ' + ds.days.off[0]);
      assert(ds.cities.some((c) => c.n === 'Barcelona'), 'ciudad Barcelona');
      assert(ds.meta.files[0].kinds.includes('seg') && ds.meta.files[0].kinds.includes('raw'), 'tipos ' + ds.meta.files[0].kinds);
    } },
    { name: 'iPhone · location-history.json', files: () => [file(IOS, 'location-history.json')], check(ds) {
      assert(ds.meta.visits === 2, 'visitas (sin sub-visitas) ' + ds.meta.visits);
      assert(ds.meta.acts === 3, 'actividades ' + ds.meta.acts);
      assert(countriesOf(ds).join() === 'US', 'países ' + countriesOf(ds));
      assert(ds.days.off[0] === -240, 'desfase ' + ds.days.off[0]);
      assert(ds.segs.mode.length > 0, 'sin tramos');
      assert(Array.from(ds.acts.mode).includes(4), 'metro no reconocido');
    } },
    { name: 'Takeout · Semantic Location History', files: () => [file(SEMANTIC, '2025_JULY.json')], check(ds) {
      assert(ds.meta.visits === 3, 'visitas ' + ds.meta.visits);
      assert(ds.places.some((p) => p.name === 'Times Square'), 'nombres de lugar');
      assert(Math.abs(totalKm(ds) - 3.1) < 0.05, 'km ' + totalKm(ds));
      assert(ds.days.off[0] === -240, 'huso deducido por ciudad ' + ds.days.off[0]);
    } },
    { name: 'Takeout · Records.json (E7 desbordado, saltos, duplicados)', files: () => [file(recordsText(200), 'Records.json')], check(ds) {
      assert(countriesOf(ds).join() === 'US', 'países ' + countriesOf(ds) + ' (el salto a París debe eliminarse)');
      assert(ds.meta.warnings.some((w) => /precisión/.test(w)), 'aviso precisión');
      assert(ds.meta.warnings.some((w) => /salto/.test(w)), 'aviso saltos');
      assert(ds.meta.inferredModes && ds.segs.mode.length > 0, 'modos inferidos');
      assert(ds.meta.rawPoints === 200, 'puntos leídos ' + ds.meta.rawPoints);
    } },
    { name: 'Records.json · vuelo con GPS (sobrevolar no es visitar)', files: () => {
      // Madrid → Roma a 220 m/s con un punto por minuto, pasando por encima de Francia; un día en Roma y vuelta
      const out = [], mad = [40.4168, -3.7038], rom = [41.9028, 12.4964];
      let t = Date.UTC(2023, 4, 2, 6, 0, 0);
      const push = (la, lo) => { out.push({ latitudeE7: Math.round(la * 1e7), longitudeE7: Math.round(lo * 1e7), accuracy: 15, timestamp: new Date(t).toISOString() }); };
      for (let i = 0; i < 120; i++) { push(mad[0] + (i % 3) * 1e-4, mad[1]); t += 120000; }
      const wp = [mad, [43.6, 1.44], [43.7, 7.26], rom]; // pasa por Toulouse y Niza
      for (let s = 1; s < wp.length; s++) for (let i = 1; i <= 40; i++) { const f = i / 40; push(wp[s - 1][0] + (wp[s][0] - wp[s - 1][0]) * f, wp[s - 1][1] + (wp[s][1] - wp[s - 1][1]) * f); t += 60000; }
      for (let i = 0; i < 400; i++) { push(rom[0] + (i % 5) * 1e-4, rom[1]); t += 300000; }
      return [file(JSON.stringify({ locations: out }), 'Records.json')];
    }, check(ds) {
      assert(countriesOf(ds).join() === 'ES,IT', 'países ' + countriesOf(ds) + ' (Francia solo se sobrevuela)');
      assert(ds.days.kmMode.some((v, i) => i % 8 === 6 && v > 500), 'el vuelo debe contar como avión');
    } },
    { name: 'GPX', files: () => [file(GPX, 'paseo.gpx', 'application/gpx+xml')], check(ds) {
      assert(countriesOf(ds).join() === 'ES', 'países ' + countriesOf(ds));
      assert(ds.places.some((p) => p.name === 'Puerta del Sol'), 'waypoint con nombre');
      assert(ds.meta.files[0].format === 'gpx', 'formato ' + ds.meta.files[0].format);
    } },
    { name: 'KML · Location History.kml (gx:Track)', files: () => [file(KML_TRACK, 'Location History.kml', 'application/vnd.google-earth.kml+xml')], check(ds) {
      assert(countriesOf(ds).join() === 'FR', 'países ' + countriesOf(ds));
      assert(ds.meta.rawPoints === 40, 'puntos ' + ds.meta.rawPoints);
    } },
    { name: 'KML · exportación de un día (Placemark)', files: () => [file(KML_DAY, 'history-2019-05-04.kml')], check(ds) {
      assert(ds.places.some((p) => p.name === 'Museo del Louvre'), 'visita con nombre');
      assert(ds.meta.acts === 1 && ds.acts.mode[0] === 1, 'tramo a pie');
    } },
    { name: 'CSV con punto y coma', files: () => [file(CSV, 'puntos.csv', 'text/csv')], check(ds) {
      assert(countriesOf(ds).join() === 'IT', 'países ' + countriesOf(ds));
      assert(ds.meta.rawPoints === 30, 'puntos ' + ds.meta.rawPoints);
    } },
    { name: 'JSON con comillas, barras y llaves en los textos (cortes de bloque)', files: () => [file(trickyAndroid(9000), 'tricky.json')], check(ds) {
      assert(ds.meta.visits === 9000, 'visitas ' + ds.meta.visits);
      assert(ds.meta.files[0].bad === 0, 'fragmentos ilegibles ' + ds.meta.files[0].bad);
      assert(ds.meta.files[0].size > 2.5e6, 'tamaño de prueba ' + ds.meta.files[0].size);
    } },
    { name: 'Archivo cortado a la mitad', files: () => [file(ANDROID.slice(0, Math.floor(ANDROID.length * 0.6)), 'Timeline.json')], check(ds) {
      assert(ds.meta.visits >= 1, 'debe leer lo que hay');
      assert(ds.meta.warnings.some((w) => /incompleto/.test(w)), 'aviso de archivo cortado');
    } },
    { name: 'Varios archivos a la vez (Android + iPhone)', files: () => [file(ANDROID, 'Timeline.json'), file(IOS, 'iphone.json')], check(ds) {
      assert(countriesOf(ds).join() === 'ES,US', 'países ' + countriesOf(ds));
      assert(ds.meta.files.length === 2, 'archivos ' + ds.meta.files.length);
    } },
    { name: 'Mismo archivo dos veces (sin duplicar)', files: () => [file(ANDROID, 'a.json'), file(ANDROID, 'b.json')], check(ds) {
      assert(ds.meta.visits === 3, 'visitas duplicadas ' + ds.meta.visits);
      assert(ds.meta.acts === 2, 'actividades duplicadas ' + ds.meta.acts);
    } },
    { name: 'ZIP de Takeout (en español, deflate + stored)', files: async () => [await makeZip([
      { name: 'Takeout/Historial de ubicaciones (Cronología)/Records.json', data: recordsText(150), deflate: true },
      { name: 'Takeout/Historial de ubicaciones (Cronología)/Semantic Location History/2025/2025_JULIO.json', data: SEMANTIC, deflate: false },
      { name: 'Takeout/Historial de ubicaciones (Cronología)/Settings.json', data: '{"createdTime":"2020"}', deflate: true },
      { name: 'Takeout/Chrome/Historial.json', data: JSON.stringify({ 'Browser History': Array.from({ length: 2000 }, (_, i) => ({ title: 'p' + i, url: 'https://x/' + i })) }), deflate: true },
      { name: 'Takeout/archivo_de_navegador.html', data: '<html></html>', deflate: true },
    ])], check(ds) {
      assert(ds.meta.files.length === 2, 'entradas leídas ' + ds.meta.files.map((f) => f.name).join(' | '));
      assert(ds.meta.visits === 3 && ds.meta.rawPoints > 150, 'contenido ' + ds.meta.visits + ' / ' + ds.meta.rawPoints);
    } },
    { name: 'Error · archivo vacío', files: () => [file('', 'vacio.json')], error: /ubicaci|No parece/ },
    { name: 'Error · JSON sin ubicaciones', files: () => [file('{"foo":[{"bar":1}],"baz":"x"}', 'otro.json')], error: /ninguna ubicación/ },
    { name: 'Error · HTML con extensión .json', files: () => [file('<!doctype html><html><body>hola</body></html>', 'web.json')], error: /XML|ubicaci/ },
    { name: 'Error · binario', files: () => [new File([new Uint8Array(4096).map((_, i) => (i * 37) % 256)], 'foto.json')], error: /./ },
    { name: 'Error · zip roto', files: () => [file('PK\u0003\u0004 esto no es un zip', 'roto.zip', 'application/zip')], error: /zip/ },
    { name: 'Demo completa (2 años, 10 viajes)', files: () => [H.makeDemoFile()], check(ds) {
      const cs = countriesOf(ds);
      for (const c of ['ES', 'IT', 'GB', 'PT', 'FR', 'JP', 'US', 'AD']) assert(cs.includes(c), 'falta ' + c + ' en ' + cs);
      assert(ds.trips.length >= 9, 'viajes ' + ds.trips.length);
      assert(ds.meta.visits > 2500, 'visitas ' + ds.meta.visits);
      assert(ds.places.find((p) => p.type === 'home'), 'casa');
      assert(ds.homes.length === 1, 'casas ' + ds.homes.length + ' (no se ha mudado)');
      assert(ds.segs.mode.length > 2000, 'tramos ' + ds.segs.mode.length);
      const jp = ds.trips.find((t) => isoOf(t.c) === 'JP');
      assert(jp && jp.d1 - jp.d0 >= 9, 'viaje a Japón ' + JSON.stringify(jp && { d: jp.d1 - jp.d0 }));
      return 'países ' + cs.join(' ') + ' · viajes ' + ds.trips.length + ' · ' + Math.round(totalKm(ds)).toLocaleString('es-ES') + ' km';
    } },
  ];

  function row(ok, name, detail) {
    const d = document.createElement('div');
    d.className = 't ' + (ok ? 'ok' : 'ko');
    d.innerHTML = (ok ? '✔ ' : '✘ ') + name + '<small></small>';
    d.querySelector('small').textContent = detail || '';
    document.getElementById('out').appendChild(d);
  }

  async function runAll() {
    document.getElementById('out').innerHTML = '';
    let pass = 0;
    window.__results = [];
    for (const t of TESTS) {
      const t0 = performance.now();
      try {
        const files = await t.files();
        let ds = null, err = null;
        try { ds = await engine.run(files); } catch (e) { err = e; }
        const ms = Math.round(performance.now() - t0);
        if (t.error) {
          if (!err) throw new Error('debía fallar y no falló');
          if (!t.error.test(err.message)) throw new Error('mensaje inesperado: ' + err.message);
          row(true, t.name, '→ «' + err.message + '» · ' + ms + ' ms');
        } else {
          if (err) throw err;
          const extra = t.check(ds);
          row(true, t.name, (extra ? extra + ' · ' : '') + ds.meta.points.toLocaleString('es-ES') + ' puntos · ' + ms + ' ms' + (ds.meta.warnings.length ? '\nAvisos: ' + ds.meta.warnings.join(' · ') : ''));
        }
        pass++;
        window.__results.push({ name: t.name, ok: true });
      } catch (e) {
        row(false, t.name, e.message);
        window.__results.push({ name: t.name, ok: false, msg: e.message });
      }
    }
    document.getElementById('sum').textContent = pass + ' / ' + TESTS.length + ' correctas';
    window.__done = true;
    return { pass, total: TESTS.length };
  }

  async function big() {
    // ~700 MB: más que el string máximo de Chrome; solo funciona si el lector va de verdad en streaming
    const head = '{\n  "locations": [';
    const parts = [head];
    const per = 10000, blocks = 300;
    const t0 = Date.UTC(2016, 0, 1);
    let k = 0;
    for (let b = 0; b < blocks; b++) {
      const arr = [];
      for (let i = 0; i < per; i++, k++) {
        const ang = k / 5000;
        arr.push('{\n    "latitudeE7": ' + Math.round((41.39 + Math.sin(ang) * 0.05 + (k % 97) * 1e-5) * 1e7) + ',\n    "longitudeE7": ' + Math.round((2.16 + Math.cos(ang * 1.3) * 0.07) * 1e7) +
          ',\n    "accuracy": ' + (5 + (k % 40)) + ',\n    "velocity": 0,\n    "altitude": 52,\n    "verticalAccuracy": 3,\n    "source": "WIFI",\n    "deviceTag": 1234567,\n    "platformType": "ANDROID",\n    "activity": [{\n      "activity": [{\n        "type": "STILL",\n        "confidence": 100\n      }],\n      "timestamp": "' +
          new Date(t0 + k * 60000).toISOString() + '"\n    }],\n    "timestamp": "' + new Date(t0 + k * 60000).toISOString() + '"\n  }');
      }
      parts.push((b ? ',' : '') + arr.join(', '));
      if (b % 10 === 0) { document.getElementById('sum').textContent = 'Generando ' + Math.round((b / blocks) * 100) + '%'; await new Promise((r) => setTimeout(r, 0)); }
    }
    parts.push(']\n}');
    const f = new File(parts, 'Records-grande.json');
    row(true, 'Generado ' + (f.size / 1e6).toFixed(0) + ' MB con ' + k.toLocaleString('es-ES') + ' puntos', '');
    const t1 = performance.now();
    try {
      const ds = await engine.run([f], (p) => { document.getElementById('sum').textContent = p.msg + ' ' + Math.round(p.pct * 100) + '%'; });
      const secs = ((performance.now() - t1) / 1000).toFixed(1);
      row(ds.meta.rawPoints === k, 'Archivo gigante en streaming', ds.meta.rawPoints.toLocaleString('es-ES') + ' puntos leídos → ' + ds.meta.points.toLocaleString('es-ES') + ' tras simplificar · ' + secs + ' s');
      window.__big = { ok: ds.meta.rawPoints === k, secs, size: f.size, pts: ds.meta.points };
    } catch (e) {
      row(false, 'Archivo gigante en streaming', e.message);
      window.__big = { ok: false, msg: e.message };
    }
  }

  document.getElementById('run').onclick = runAll;
  document.getElementById('big').onclick = big;
  window.runAll = runAll;
  window.runBig = big;
})();
