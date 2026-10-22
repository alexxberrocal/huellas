/* Huellas · utilidades compartidas: modos de transporte, colores, formato en español, iconos y DOM. */
(function () {
  'use strict';
  const H = (window.H = window.H || {});

  // Paleta categórica validada (orden fijo; ver la guía de visualización). Un color = un medio, siempre.
  H.MODES = [
    { key: 'car', name: 'Coche y moto', short: 'Coche', icon: 'car', color: '#3987e5' },
    { key: 'walk', name: 'A pie', short: 'A pie', icon: 'footprints', color: '#d95926' },
    { key: 'bike', name: 'Bici y patinete', short: 'Bici', icon: 'bike', color: '#199e70' },
    { key: 'bus', name: 'Bus y tranvía', short: 'Bus', icon: 'bus', color: '#c98500' },
    { key: 'train', name: 'Tren y metro', short: 'Tren', icon: 'train-front', color: '#d55181' },
    { key: 'boat', name: 'Barco', short: 'Barco', icon: 'ship', color: '#008300' },
    { key: 'plane', name: 'Avión', short: 'Avión', icon: 'plane', color: '#9085e9' },
    { key: 'other', name: 'Otros', short: 'Otros', icon: 'ellipsis', color: '#898781' },
  ];
  H.NM = H.MODES.length;

  H.hexRgb = function (hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  H.MODES.forEach((m) => { m.rgb = H.hexRgb(m.color); });

  // Rampas secuenciales (una sola familia de color) y «calor» semántico para tiempo pasado.
  H.RAMP_BLUE = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
  H.RAMP_HEAT = ['#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'];
  H.rampAt = function (ramp, f) {
    f = Math.max(0, Math.min(1, f));
    const x = f * (ramp.length - 1), i = Math.floor(x), r = x - i;
    const a = H.hexRgb(ramp[i]), b = H.hexRgb(ramp[Math.min(ramp.length - 1, i + 1)]);
    return [Math.round(a[0] + (b[0] - a[0]) * r), Math.round(a[1] + (b[1] - a[1]) * r), Math.round(a[2] + (b[2] - a[2]) * r)];
  };

  // ------------------------------------------------------------ números y fechas
  const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  H.n0 = (v) => nf0.format(Math.round(v || 0));
  H.n1 = (v) => nf1.format(v || 0);
  H.km = function (v) {
    if (!(v > 0)) return '0 km';
    if (v < 1) return H.n0(v * 1000) + ' m';
    if (v < 10) return H.n1(v) + ' km';
    return H.n0(v) + ' km';
  };
  H.plural = (n, one, many) => H.n0(n) + ' ' + (Math.round(n) === 1 ? one : many);
  H.dur = function (min) {
    min = Math.max(0, min || 0);
    if (min < 1) return '<1 min';
    if (min < 60) return Math.round(min) + ' min';
    const h = min / 60;
    if (h < 24) { const hh = Math.floor(h), mm = Math.round(min - hh * 60); return hh + ' h' + (mm ? ' ' + mm + ' min' : ''); }
    const d = h / 24;
    if (d < 10) { const dd = Math.floor(d), hh = Math.round(h - dd * 24); return dd + ' d' + (hh ? ' ' + hh + ' h' : ''); }
    return H.n0(d) + ' d';
  };
  H.hours = (min) => (min >= 600 ? H.n0(min / 60) : H.n1(min / 60)) + ' h';

  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
  const MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const DIAL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  H.MES = MES; H.MESL = MESL; H.DIA = DIA; H.DIAL = DIAL;
  const DAY = 86400000;
  H.DAY = DAY;
  // Un «día local» es el número de días desde 1970 en la hora del sitio donde estabas.
  H.dayDate = (d) => new Date(d * DAY);
  H.fmtDay = function (d, opts) {
    const x = new Date(d * DAY);
    opts = opts || {};
    const base = x.getUTCDate() + (opts.long ? ' de ' : ' ') + (opts.long ? MESL : MES)[x.getUTCMonth()];
    const y = opts.year === false ? '' : (opts.long ? ' de ' : ' ') + x.getUTCFullYear();
    return (opts.weekday ? (opts.long ? DIAL : DIA)[x.getUTCDay()] + ', ' : '') + base + y;
  };
  H.fmtMonth = (y, m, long) => (long ? MESL : MES)[m] + ' ' + y;
  H.fmtRange = function (d0, d1) {
    if (d0 === d1) return H.fmtDay(d0, { weekday: true });
    const a = new Date(d0 * DAY), b = new Date(d1 * DAY);
    if (a.getUTCFullYear() === b.getUTCFullYear()) {
      if (a.getUTCMonth() === b.getUTCMonth()) return a.getUTCDate() + '–' + b.getUTCDate() + ' ' + MES[a.getUTCMonth()] + ' ' + a.getUTCFullYear();
      return a.getUTCDate() + ' ' + MES[a.getUTCMonth()] + ' – ' + b.getUTCDate() + ' ' + MES[b.getUTCMonth()] + ' ' + a.getUTCFullYear();
    }
    return H.fmtDay(d0) + ' – ' + H.fmtDay(d1);
  };
  H.localDay = (ms, off) => Math.floor((ms + off * 60000) / DAY);
  H.fmtClock = function (ms, off) {
    const x = new Date(ms + off * 60000);
    return String(x.getUTCHours()).padStart(2, '0') + ':' + String(x.getUTCMinutes()).padStart(2, '0');
  };
  H.fmtDateTime = (ms, off) => H.fmtDay(H.localDay(ms, off)) + ' · ' + H.fmtClock(ms, off);
  H.fmtTz = (off) => 'UTC' + (off >= 0 ? '+' : '−') + Math.floor(Math.abs(off) / 60) + (Math.abs(off) % 60 ? ':' + String(Math.abs(off) % 60).padStart(2, '0') : '');
  H.bytes = function (b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return H.n0(b / 1024) + ' KB';
    if (b < 1073741824) return H.n1(b / 1048576) + ' MB';
    return H.n1(b / 1073741824) + ' GB';
  };

  // ------------------------------------------------------------ geo
  const RAD = Math.PI / 180;
  H.hav = function (a1, o1, a2, o2) {
    const dLa = (a2 - a1) * RAD, dLo = (o2 - o1) * RAD;
    const s = Math.sin(dLa / 2), t = Math.sin(dLo / 2);
    return 12742.0176 * Math.asin(Math.min(1, Math.sqrt(s * s + Math.cos(a1 * RAD) * Math.cos(a2 * RAD) * t * t)));
  };
  H.lowerBound = function (arr, v, lo, hi) {
    lo = lo || 0; hi = hi === undefined ? arr.length : hi;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
    return lo;
  };
  H.flag = function (iso) {
    if (!iso || iso.length !== 2) return '🏳️';
    return String.fromCodePoint(...iso.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0)));
  };

  // ------------------------------------------------------------ iconos y DOM
  H.icon = function (name, cls) {
    const body = (window.HUELLAS_ICONS || {})[name] || '';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  };
  H.$ = (sel, root) => (root || document).querySelector(sel);
  H.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  H.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  H.el = function (tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  };
  H.debounce = function (fn, ms) {
    let t = 0;
    return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); };
  };
  H.rafThrottle = function (fn) {
    let queued = false, args = null;
    return function () { args = arguments; if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn.apply(null, args); }); };
  };
  H.storage = {
    get(k, d) { try { const v = localStorage.getItem('huellas.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('huellas.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
  };
  H.download = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  };
})();
