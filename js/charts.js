/* Huellas · gráficos en SVG (sin librerías): barras por medio, meses apilados, calendario y horario. */
(function () {
  'use strict';
  const H = window.H;
  const C = (H.charts = {});

  // ---------------------------------------------------------------- tooltip compartido
  const tip = () => document.getElementById('tip');
  H.tipShow = function (html, x, y) {
    const t = tip();
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, top) + 'px';
  };
  H.tipHide = function () { tip().hidden = true; };
  function bindTips(el, getHtml, onClick) {
    el.addEventListener('mousemove', (e) => {
      const target = e.target.closest('[data-k]');
      if (!target) { H.tipHide(); return; }
      const html = getHtml(target.dataset.k);
      if (html) H.tipShow(html, e.clientX, e.clientY); else H.tipHide();
    });
    el.addEventListener('mouseleave', H.tipHide);
    if (onClick) el.addEventListener('click', (e) => { const target = e.target.closest('[data-k]'); if (target) { H.tipHide(); onClick(target.dataset.k); } });
  }
  C.bindTips = bindTips;

  const modeIcon = (m) => '<span class="mrow-ic" style="background:' + H.MODES[m].color + '">' + H.icon(H.MODES[m].icon) + '</span>';
  C.modeIcon = modeIcon;

  // ---------------------------------------------------------------- cómo te mueves
  C.modeRows = function (st, mask, onToggle) {
    const order = H.MODES.map((m, i) => i).filter((i) => st.km[i] > 0.05 || st.min[i] > 1).sort((a, b) => st.km[b] - st.km[a]);
    if (!order.length) return '<div class="empty">No hay desplazamientos en este periodo.</div>';
    const max = st.km[order[0]] || 1;
    return '<div class="mrows">' + order.map((m) => {
      const pct = st.totalKm > 0 ? (st.km[m] / st.totalKm) * 100 : 0;
      return '<button class="mrow' + (mask & (1 << m) ? '' : ' off') + '" data-mode="' + m + '" title="Mostrar u ocultar en el mapa">' + modeIcon(m) +
        '<span class="mrow-main"><span class="mrow-top"><span>' + H.MODES[m].name + '</span><span class="v">' + H.km(st.km[m]) + '</span></span>' +
        '<span class="mrow-bar"><i style="width:' + Math.max(1.5, (st.km[m] / max) * 100).toFixed(1) + '%;background:' + H.MODES[m].color + '"></i></span></span>' +
        '<span class="mrow-side">' + (pct >= 1 ? Math.round(pct) + ' %' : '<1 %') + '<br>' + H.dur(st.min[m]) + '</span></button>';
    }).join('') + '</div>';
  };

  // ---------------------------------------------------------------- km por mes (barras apiladas)
  C.monthly = function (el, st, f, D) {
    const keys = Array.from(st.months.keys());
    const a = new Date(D.absDay(f.d0) * H.DAY), b = new Date(D.absDay(f.d1) * H.DAY);
    let k0 = a.getUTCFullYear() * 12 + a.getUTCMonth(), k1 = b.getUTCFullYear() * 12 + b.getUTCMonth();
    if (!keys.length) { el.innerHTML = '<div class="empty">Sin kilómetros en este periodo.</div>'; return; }
    const yearly = k1 - k0 + 1 > 36;
    const buckets = [];
    if (yearly) {
      for (let y = Math.floor(k0 / 12); y <= Math.floor(k1 / 12); y++) {
        const v = new Float64Array(H.NM);
        for (let m = 0; m < 12; m++) { const arr = st.months.get(y * 12 + m); if (arr) for (let i = 0; i < H.NM; i++) v[i] += arr[i]; }
        buckets.push({ label: String(y), long: String(y), v });
      }
    } else {
      for (let k = k0; k <= k1; k++) {
        const y = Math.floor(k / 12), m = k % 12;
        buckets.push({ label: H.MES[m].slice(0, 1).toUpperCase(), long: H.fmtMonth(y, m, true), v: st.months.get(k) || new Float64Array(H.NM), y, m });
      }
    }
    const tot = buckets.map((x) => x.v.reduce((s, v) => s + v, 0));
    const max = Math.max(1, ...tot);
    const W = Math.max(260, el.clientWidth || 340), PH = 128, top = 8, left = 34, bottom = 20;
    const nice = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
    const step = nice(max / 3), ymax = step * Math.ceil(max / step);
    const bw = (W - left) / buckets.length, gap = Math.min(4, Math.max(2, bw * 0.22));
    const y = (v) => top + PH - (v / ymax) * PH;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + (top + PH + bottom) + '" height="' + (top + PH + bottom) + '"><g class="grid">';
    for (let v = 0; v <= ymax + 1e-9; v += step) {
      svg += '<line x1="' + left + '" x2="' + W + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>';
      svg += '<text x="' + (left - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + (v >= 1000 ? H.n0(v / 1000) + 'k' : H.n0(v)) + '</text>';
    }
    svg += '</g>';
    buckets.forEach((bk, i) => {
      const x = left + i * bw + gap / 2, w = Math.max(1, bw - gap);
      let base = top + PH;
      const segs = [];
      for (let m = 0; m < H.NM; m++) {
        const v = bk.v[m];
        if (v <= 0) continue;
        const h = (v / ymax) * PH;
        segs.push({ m, y: base - h, h });
        base -= h;
      }
      segs.forEach((s, j) => {
        const last = j === segs.length - 1;
        const hh = Math.max(0.6, s.h - (last ? 0 : 1.5));
        const r = last ? Math.min(3, w / 2, hh) : 0;
        const yy = s.y + (last ? 0 : 1.5);
        svg += r > 0
          ? '<path d="M' + x.toFixed(1) + ',' + (yy + hh).toFixed(1) + 'V' + (yy + r).toFixed(1) + 'Q' + x.toFixed(1) + ',' + yy.toFixed(1) + ' ' + (x + r).toFixed(1) + ',' + yy.toFixed(1) + 'H' + (x + w - r).toFixed(1) + 'Q' + (x + w).toFixed(1) + ',' + yy.toFixed(1) + ' ' + (x + w).toFixed(1) + ',' + (yy + r).toFixed(1) + 'V' + (yy + hh).toFixed(1) + 'Z" fill="' + H.MODES[s.m].color + '"/>'
          : '<rect x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hh.toFixed(1) + '" fill="' + H.MODES[s.m].color + '"/>';
      });
      const showLabel = yearly || buckets.length <= 14 || bk.m === 0 || i === 0;
      if (showLabel) svg += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (top + PH + 14) + '" text-anchor="middle">' + (yearly ? bk.label : bk.m === 0 || i === 0 ? (buckets.length > 14 ? "'" + String(bk.y).slice(2) : bk.label) : bk.label) + '</text>';
      svg += '<rect class="hit" data-k="' + i + '" x="' + (left + i * bw).toFixed(1) + '" y="' + top + '" width="' + bw.toFixed(1) + '" height="' + PH + '"/>';
    });
    svg += '<line class="axis" x1="' + left + '" x2="' + W + '" y1="' + (top + PH) + '" y2="' + (top + PH) + '" stroke="#383835"/></svg>';
    const present = H.MODES.map((m, i) => i).filter((i) => buckets.some((bk) => bk.v[i] > 0));
    el.innerHTML = '<div class="chart">' + svg + '</div><div class="legend-row">' + present.map((i) => '<span><i class="swatch" style="background:' + H.MODES[i].color + '"></i>' + H.MODES[i].short + '</span>').join('') + '</div>';
    bindTips(el.firstChild, (k) => {
      const bk = buckets[+k];
      const rows = H.MODES.map((m, i) => i).filter((i) => bk.v[i] > 0).sort((p, q) => bk.v[q] - bk.v[p]);
      return '<b>' + bk.long + '</b> · ' + H.km(tot[+k]) + (rows.length ? '<div style="margin-top:6px;display:grid;gap:3px">' + rows.map((i) => '<div class="t-row"><span><i class="swatch" style="background:' + H.MODES[i].color + '"></i>' + H.MODES[i].short + '</span><span>' + H.km(bk.v[i]) + '</span></div>').join('') + '</div>' : '<div class="t-s">Sin desplazamientos</div>');
    });
  };

  // ---------------------------------------------------------------- calendario (12 mini-meses)
  C.calendar = function (el, cal, year, opts) {
    opts = opts || {};
    const W = Math.max(280, el.clientWidth || 340);
    const cols = W < 330 ? 3 : 3, gapX = 12;
    const mw = (W - gapX * (cols - 1)) / cols;
    const cell = Math.floor((mw - 6 * 2) / 7), step = cell + 2;
    const mh = 16 + 6 * step;
    // escala hasta el percentil 95: un día de avión no deja al resto del año del mismo color
    const pos = Array.from(cal.vals).filter((v, i) => v > 0 && cal.has[i]).sort((a, b) => a - b);
    const max = pos.length ? pos[Math.min(pos.length - 1, Math.floor(pos.length * 0.95))] : 0;
    const color = (v) => H.rampAt(H.RAMP_BLUE.slice(1), max > 0 ? Math.min(1, Math.log1p(v) / Math.log1p(max)) : 0);
    const rows = Math.ceil(12 / cols);
    let svg = '<svg class="cal" viewBox="0 0 ' + W + ' ' + (rows * (mh + 10)) + '" height="' + rows * (mh + 10) + '">';
    for (let m = 0; m < 12; m++) {
      const ox = (m % cols) * (mw + gapX), oy = Math.floor(m / cols) * (mh + 10);
      svg += '<text x="' + ox + '" y="' + (oy + 10) + '" style="fill:#c3c2b7;font-weight:600">' + H.MESL[m].charAt(0).toUpperCase() + H.MESL[m].slice(1) + '</text>';
      const first = Date.UTC(year, m, 1), dim = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
      const wd0 = (new Date(first).getUTCDay() + 6) % 7; // lunes = 0
      for (let d = 1; d <= dim; d++) {
        const idx = Math.floor(Date.UTC(year, m, d) / H.DAY) - Math.floor(Date.UTC(year, 0, 1) / H.DAY);
        const pos = wd0 + d - 1, cx = ox + (pos % 7) * step, cy = oy + 16 + Math.floor(pos / 7) * step;
        const has = cal.has[idx], v = cal.vals[idx];
        const fill = has ? 'rgb(' + color(v).join(',') + ')' : 'rgba(255,255,255,0.045)';
        const sel = opts.selected === cal.d0 + idx ? ' sel' : '';
        svg += '<rect class="day' + sel + '" data-k="' + idx + '" x="' + cx.toFixed(1) + '" y="' + cy.toFixed(1) + '" width="' + cell + '" height="' + cell + '" fill="' + fill + '"/>';
      }
    }
    svg += '</svg>';
    const ramp = [0, 0.25, 0.5, 0.75, 1].map((f) => '<i style="background:rgb(' + H.rampAt(H.RAMP_BLUE.slice(1), f).join(',') + ')"></i>').join('');
    el.innerHTML = '<div class="chart">' + svg + '</div><div class="scale"><i style="background:rgba(255,255,255,0.045)"></i>sin datos<span style="flex:1"></span>0 km ' + ramp + ' ' + (pos.length && pos[pos.length - 1] > max ? '≥ ' : '') + H.km(max) + '</div>';
    bindTips(el.firstChild, (k) => {
      const i = +k, d = cal.d0 + i;
      return '<b>' + H.fmtDay(d, { weekday: true, year: true }) + '</b><div class="t-s">' + (cal.has[i] ? H.km(cal.vals[i]) + ' recorridos' : 'Sin datos este día') + '</div>';
    }, (k) => { if (opts.onDay && cal.has[+k]) opts.onDay(cal.d0 + +k); });
  };

  // ---------------------------------------------------------------- horario: día de la semana × hora
  const WD = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  C.punch = function (el, arr) {
    const W = Math.max(260, el.clientWidth || 340), left = 20, top = 4, cw = (W - left) / 24, ch = Math.min(22, cw * 1.25);
    let max = 0;
    for (const v of arr) if (v > max) max = v;
    if (max <= 0) { el.innerHTML = '<div class="empty">Sin desplazamientos en este periodo.</div>'; return; }
    let svg = '<svg viewBox="0 0 ' + W + ' ' + (top + ch * 7 + 18) + '" height="' + (top + ch * 7 + 18) + '">';
    for (let r = 0; r < 7; r++) {
      const wd = (r + 1) % 7; // fila 0 = lunes
      svg += '<text x="0" y="' + (top + r * ch + ch / 2 + 3.5).toFixed(1) + '">' + WD[r] + '</text>';
      for (let h = 0; h < 24; h++) {
        const v = arr[wd * 24 + h], f = Math.sqrt(v / max);
        const cx = left + h * cw + cw / 2, cy = top + r * ch + ch / 2;
        svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + Math.max(v > 0 ? 1.2 : 0.8, f * Math.min(cw, ch) * 0.46).toFixed(2) + '" fill="' + (v > 0 ? '#3987e5' : '#2c2c2a') + '" fill-opacity="' + (v > 0 ? (0.35 + 0.65 * f).toFixed(2) : 1) + '"/>';
        svg += '<rect class="hit" data-k="' + (wd * 24 + h) + '" x="' + (left + h * cw).toFixed(1) + '" y="' + (top + r * ch).toFixed(1) + '" width="' + cw.toFixed(1) + '" height="' + ch.toFixed(1) + '"/>';
      }
    }
    for (const h of [0, 6, 12, 18, 23]) svg += '<text x="' + (left + h * cw + cw / 2).toFixed(1) + '" y="' + (top + ch * 7 + 14) + '" text-anchor="middle">' + h + 'h</text>';
    svg += '</svg>';
    el.innerHTML = '<div class="chart">' + svg + '</div>';
    bindTips(el.firstChild, (k) => {
      const wd = Math.floor(+k / 24), h = +k % 24;
      return '<b>' + H.DIAL[wd].charAt(0).toUpperCase() + H.DIAL[wd].slice(1) + ', ' + h + ':00–' + (h + 1) + ':00</b><div class="t-s">' + H.hours(arr[+k]) + ' en movimiento en total</div>';
    });
  };

  // ---------------------------------------------------------------- km medios por día de la semana
  C.weekday = function (el, st, D, f) {
    const sum = new Float64Array(7), cnt = new Float64Array(7);
    for (let d = f.d0; d <= f.d1; d++) {
      if (D.ds.days.pts[d] === 0) continue;
      const wd = D.weekday(d);
      sum[wd] += st.dayKm[d - f.d0] || 0;
      cnt[wd]++;
    }
    const avg = Array.from({ length: 7 }, (_, r) => { const wd = (r + 1) % 7; return cnt[wd] ? sum[wd] / cnt[wd] : 0; });
    const max = Math.max(...avg);
    if (!(max > 0)) { el.innerHTML = '<div class="empty">Sin datos suficientes.</div>'; return; }
    const W = Math.max(260, el.clientWidth || 340), PH = 84, top = 16, bw = W / 7;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + (top + PH + 18) + '" height="' + (top + PH + 18) + '">';
    avg.forEach((v, r) => {
      const h = Math.max(1, (v / max) * PH), x = r * bw + bw * 0.18, w = bw * 0.64, y = top + PH - h, rr = Math.min(4, w / 2, h);
      svg += '<path d="M' + x.toFixed(1) + ',' + (top + PH) + 'V' + (y + rr).toFixed(1) + 'Q' + x.toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + rr).toFixed(1) + ',' + y.toFixed(1) + 'H' + (x + w - rr).toFixed(1) + 'Q' + (x + w).toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + w).toFixed(1) + ',' + (y + rr).toFixed(1) + 'V' + (top + PH) + 'Z" fill="#3987e5"/>';
      if (v === max) svg += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" style="fill:#f0efec;font-weight:600">' + H.km(v) + '</text>';
      svg += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (top + PH + 14) + '" text-anchor="middle">' + WD[r] + '</text>';
      svg += '<rect class="hit" data-k="' + r + '" x="' + (r * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (top + PH) + '"/>';
    });
    svg += '<line x1="0" x2="' + W + '" y1="' + (top + PH) + '" y2="' + (top + PH) + '" stroke="#383835"/></svg>';
    el.innerHTML = '<div class="chart">' + svg + '</div>';
    bindTips(el.firstChild, (k) => { const wd = (+k + 1) % 7; return '<b>' + H.DIAL[wd].charAt(0).toUpperCase() + H.DIAL[wd].slice(1) + '</b><div class="t-s">' + H.km(avg[+k]) + ' de media · ' + H.plural(cnt[wd], 'día', 'días') + ' con datos</div>'; });
  };
})();
