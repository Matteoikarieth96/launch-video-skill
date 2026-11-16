'use strict';
/* launch-video engine: a deterministic canvas renderer. Every frame is a pure function of t (seconds).
   Data: window.VIDEO (build/data.js, made from video.json) and window.CAPTURES (captures/<theme>/meta.js).
   Primitives and layout live here; the scene types are in scenes.js. */
const QS = new URLSearchParams(location.search);
const VID = window.VIDEO;
const FORMAT = QS.get('format') === '9x16' ? '9x16' : '16x9', V = FORMAT === '9x16';
const W = V ? 1080 : 1920, H = V ? 1920 : 1080;
const THEME = VID.themes.includes(QS.get('theme')) ? QS.get('theme') : VID.themes[0];
const DARK = THEME === 'dark';
const CAPS = (window.CAPTURES || {})[THEME] || {};
const BEAT = 60 / VID.timeline.bpm, TOTAL = VID.timeline.beats * BEAT;
const B = b => b * BEAT;
const WARN = new Set();

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, u) => a + (b - a) * u;
const prog = (t, a, d) => clamp((t - a) / d);
const eo3 = u => 1 - Math.pow(1 - u, 3);
const eo5 = u => 1 - Math.pow(1 - u, 5);
const eio = u => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const eback = u => { const c = 1.4; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------- colour ----------
function hex(c) {
  if (c[0] !== '#') { const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2]]; }
  const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function mix(a, b, u) { const A = hex(a), Bc = hex(b); return 'rgb(' + A.map((v, i) => Math.round(lerp(v, Bc[i], clamp(u)))).join(',') + ')'; }
const rgbOf = c => hex(c).join(',');
const lum = c => { const [r, g2, b] = hex(c); return (0.2126 * r + 0.7152 * g2 + 0.0722 * b) / 255; };
/* the theme: video.json tokens plus a few derived ones */
const C = (() => {
  const c = { ...VID.colors[THEME] };
  c.line = DARK ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  c.cardLine = DARK ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
  c.shadow = DARK ? 0.5 : 0.10;
  c.bar = c.card; c.barLine = c.line; c.dots = DARK ? '#3a3a3c' : '#e3e3e8';
  c.panel = rgbOf(DARK ? c.bg : c.card);
  c.phoneRim = DARK ? '#5a5a5e' : '#3a3a3c';
  c.status = `rgba(${rgbOf(c.bg)},0.94)`;
  c.lineNo = mix(c.faint, c.card, 0.35);
  return c;
})();
const SYS = '-apple-system, "SF Pro Display", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SANS = VID.font.family === 'system' ? SYS : `"${VID.font.family}", ${SYS}`;
const TEXT = VID.font.family === 'system' ? '-apple-system, "SF Pro Text", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' : SANS;
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

const main = document.getElementById('c'); main.width = W; main.height = H;
const g = main.getContext('2d');
g.imageSmoothingQuality = 'high';

/* ---------- layout per format ----------
   16:9: titles on the left third, the product on the right. 9:16: titles on top, the product below, inside the
   area that Reels, Shorts and TikTok leave free (their buttons sit on the right edge, the caption at the bottom). */
const L = V ? {
  tx: 72, tcy: 440, tMaxW: 936, tMaxBig: 170, lead: 54, sub: 36,
  textCy: 860, textMaxW: 936, textMaxBig: 170,
  win: { x: 24, y: 740, w: 1032, h: 1100 }, vis: { x: 72, y: 740, w: 936, h: 880 },
  phone: { cx: 540, cy: 1250, k: 1.22 }, safeBottom: 1640,
} : {
  tx: 96, tcy: 540, tMaxW: 620, tMaxBig: 160, lead: 46, sub: 30,
  textCy: 500, textMaxW: 1560, textMaxBig: 150,
  win: { x: 760, y: 92, w: 1250, h: 1060 }, vis: { x: 1000, y: 150, w: 800, h: 780 },
  phone: { cx: 1300, cy: 560, k: 1 }, safeBottom: 1040,
};

// ---------- images ----------
const IMG = {};
function loadImg(key, src) {
  return new Promise(res => { const im = new Image(); im.onload = () => { IMG[key] = im; res(1); }; im.onerror = () => { WARN.add('image failed to load: ' + src); res(0); }; im.src = '../' + src; });
}

// ---------- text ----------
function font(weight, size, fam = SANS) { return `${weight} ${size}px ${fam}`; }
function T(s, x, y, o = {}) {
  const { size = 40, weight = 600, fam = SANS, fill = C.ink, align = 'left', base = 'alphabetic', ls = 0, alpha = 1 } = o;
  if (alpha <= 0.002 || !s) return 0;
  g.save(); g.globalAlpha *= clamp(alpha); g.font = font(weight, size, fam); g.letterSpacing = ls + 'px';
  g.textAlign = align; g.textBaseline = base; g.fillStyle = fill; g.fillText(s, x, y);
  const w = g.measureText(s).width; g.restore(); return w;
}
const _mw = {};
function tw(s, size, weight = 600, fam = SANS, lsEm = 0) {
  const k = [s, weight, fam, lsEm].join('|');
  if (_mw[k] === undefined) { g.save(); g.font = font(weight, 100, fam); g.letterSpacing = (lsEm * 100) + 'px'; _mw[k] = g.measureText(s).width; g.restore(); }
  return _mw[k] * size / 100;
}
/* largest size <= maxSize with which s fits in maxW */
function fitSize(s, maxW, maxSize, weight = 800, lsEm = 0, fam = SANS) { return Math.min(maxSize, maxW / (tw(s, 1, weight, fam, lsEm) || 1)); }
/* break s into lines that fit maxW at size; shrinks down to minSize if more than maxLines lines are needed */
function wrapFit(s, maxW, size, o = {}) {
  const { weight = 500, fam = SANS, maxLines = 3, minSize = size * 0.7, what = s } = o;
  for (let sz = size; sz >= minSize - 0.01; sz -= 1) {
    const words = String(s).split(/\s+/), lines = []; let cur = '';
    for (const wd of words) {
      const cand = cur ? cur + ' ' + wd : wd;
      if (tw(cand, sz, weight, fam) <= maxW || !cur) cur = cand; else { lines.push(cur); cur = wd; }
    }
    if (cur) lines.push(cur);
    const fits = lines.every(l => tw(l, sz, weight, fam) <= maxW + 0.5);
    if (lines.length <= maxLines && fits) return { lines, size: sz };
    if (sz - 1 < minSize - 0.01) { WARN.add(`text too long for its box (${FORMAT}): "${String(what).slice(0, 50)}"`); return { lines: lines.slice(0, maxLines), size: sz }; }
  }
  return { lines: [String(s)], size };
}
/* numbers with tabular digits: every digit gets the same cell, so a counter does not wobble */
function numT(s, x, y, o = {}) {
  const { size = 80, weight = 700, fill = C.ink, alpha = 1, fam = SANS } = o;
  if (alpha <= 0.002) return 0;
  g.save(); g.globalAlpha *= clamp(alpha); g.font = font(weight, size, fam); g.letterSpacing = '0px'; g.fillStyle = fill; g.textBaseline = 'alphabetic';
  let cell = 0; for (const d of '0123456789') cell = Math.max(cell, g.measureText(d).width);
  let cx = x;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') { g.textAlign = 'center'; g.fillText(ch, cx + cell / 2, y); cx += cell; }
    else { g.textAlign = 'left'; g.fillText(ch, cx, y); cx += g.measureText(ch).width; }
  }
  g.restore(); return cx - x;
}
function fmtNum(v, dec, decSep) {
  const s = Math.abs(v).toFixed(dec); const [i, d] = s.split('.'); const th = decSep === ',' ? '.' : ',';
  return (v < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, th) + (d ? decSep + d : '');
}
function typed(s, t, t0, cps) { return s.slice(0, clamp(Math.floor((t - t0) * cps), 0, s.length)); }
function caret(x, y, h, t, color = C.accent, alpha = 1) {
  if ((Math.floor(t * 2.2) % 2) !== 0 || alpha <= 0) return; g.save(); g.globalAlpha *= alpha; g.fillStyle = color; g.fillRect(x, y - h, 3, h); g.restore();
}

// ---------- shapes ----------
function rr(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function card(x, y, w, h, o = {}) {
  const { r = 28, fill = C.card, alpha = 1, shadow = 1, border = true } = o;
  if (alpha <= 0.002) return;
  g.save(); g.globalAlpha *= clamp(alpha);
  if (shadow) { g.shadowColor = `rgba(0,0,0,${C.shadow * shadow})`; g.shadowBlur = 48; g.shadowOffsetY = 16; }
  rr(x, y, w, h, r); g.fillStyle = fill; g.fill();
  g.shadowColor = 'transparent';
  if (border) { rr(x + 0.5, y + 0.5, w - 1, h - 1, r); g.strokeStyle = C.cardLine; g.lineWidth = 1; g.stroke(); }
  g.restore();
}
function background() { g.fillStyle = C.bg; g.fillRect(0, 0, W, H); }
/* 16:9 only: page-colour-to-transparent panel behind the titles in the left third */
function leftPanel(alpha = 1) {
  if (V || alpha <= 0.002) return;
  g.save(); g.globalAlpha = clamp(alpha);
  const p = C.panel, gr = g.createLinearGradient(0, 0, 780, 0);
  gr.addColorStop(0, `rgba(${p},0.97)`); gr.addColorStop(0.6, `rgba(${p},0.88)`); gr.addColorStop(0.85, `rgba(${p},0.35)`); gr.addColorStop(1, `rgba(${p},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 780, H); g.restore();
}

/* ---------- title: a small bold lead-in over one big accent word, then an optional sub line ----------
   Enters word by word (the big word lands one beat after the scene starts: a music hit), exits sliding up.
   A "\n" in big breaks it; a long big word with spaces breaks itself on two lines when one line would be too small. */
function title(t, sc, o = {}) {
  const wide = o.wide;
  const x = o.x ?? L.tx, cy = o.cy ?? (wide ? L.textCy : L.tcy), maxW = o.maxW ?? (wide ? L.textMaxW : L.tMaxW);
  const maxBig = o.maxBig ?? (wide ? L.textMaxBig : L.tMaxBig), leadSize = o.leadSize ?? L.lead, subSize0 = o.subSize ?? L.sub;
  const bigLs = -0.035, bigWeight = 800;
  const ta = sc.t0 + BEAT * 0.5, tb = sc.t0 + BEAT;
  let lines = sc.big ? sc.big.split('\n') : [];
  let bigSize = lines.length ? Math.min(...lines.map(l => fitSize(l, maxW, maxBig, bigWeight, bigLs))) : 0;
  if (lines.length === 1 && bigSize < maxBig * 0.62 && lines[0].includes(' ')) {
    const wd = lines[0].split(' '); let best = null;
    for (let k = 1; k < wd.length; k++) { const a = wd.slice(0, k).join(' '), b = wd.slice(k).join(' '), m = Math.max(tw(a, 1, bigWeight, SANS, bigLs), tw(b, 1, bigWeight, SANS, bigLs)); if (!best || m < best.m) best = { m, l: [a, b] }; }
    const s2 = Math.min(...best.l.map(l => fitSize(l, maxW, maxBig, bigWeight, bigLs)));
    if (s2 > bigSize * 1.15) { lines = best.l; bigSize = s2; }
  }
  if (lines.length && bigSize < 44) WARN.add(`big word too long (${FORMAT}): "${sc.big}" (add a \\n)`);
  const ld = sc.lead ? wrapFit(sc.lead, maxW, leadSize, { weight: 700, maxLines: 2 }) : { lines: [], size: leadSize };
  const sb = sc.sub ? wrapFit(sc.sub, maxW, subSize0, { weight: 500, maxLines: V ? 3 : 2 }) : { lines: [], size: subSize0 };
  const lineH = bigSize * 0.98, leadH = ld.size * 1.15, subH = sb.size * 1.35;
  const gap = ld.size * 0.35;
  const blockH = (ld.lines.length ? ld.lines.length * leadH + gap : 0) + (lines.length ? bigSize * 0.78 + (lines.length - 1) * lineH : 0) + (sb.lines.length ? sb.size * 0.9 + sb.lines.length * subH : 0);
  const top = cy - blockH / 2;
  const yLead = top + ld.size * 0.8, yBig = top + (ld.lines.length ? ld.lines.length * leadH + gap : 0) + bigSize * 0.80;
  const ex = o.exit === false ? 0 : eio(prog(t, sc.t1 - 0.42, 0.42));
  const dyExit = -50 * ex, aExit = 1 - ex;
  const ul = eo3(prog(t, ta, 0.55));
  ld.lines.forEach((l, i) => T(l, x, yLead + i * leadH + 26 * (1 - ul) + dyExit, { size: ld.size, weight: 700, fill: C.ink, alpha: ul * aExit, ls: -0.01 * ld.size }));
  lines.forEach((l, i) => {
    const ub = eo5(prog(t, tb + i * 0.12, 0.7));
    const yy = yBig + i * lineH + 46 * (1 - ub) + dyExit * 1.2, oo = { size: bigSize, weight: bigWeight, fill: C.accent, alpha: ub * aExit, ls: bigLs * bigSize };
    if (!sc.alt) { T(l, x - bigSize * 0.03, yy, oo); return; }
    /* alt: CamelCase words in alternating accent colours, so a one-letter word like "I" reads as a word */
    let xx = x - bigSize * 0.03;
    l.split(/(?=[A-Z])/).forEach((seg, j) => { xx += T(seg, xx, yy, { ...oo, fill: j % 2 ? C.accent2 : C.accent }); });
  });
  const yLast = lines.length ? yBig + (lines.length - 1) * lineH : yLead + (ld.lines.length - 1) * leadH;
  let bottom = yLast + bigSize * 0.25;
  if (sb.lines.length) {
    const us = eo3(prog(t, tb + 0.55, 0.6));
    sb.lines.forEach((l, i) => T(l, x, yLast + sb.size * 1.9 + i * subH + 20 * (1 - us) + dyExit, { size: sb.size, weight: 500, fill: C.muted, alpha: us * aExit }));
    bottom = yLast + sb.size * 1.9 + (sb.lines.length - 1) * subH + sb.size * 0.3;
  }
  if (sc.link) linkLine(sc.link, x, bottom + (V ? 84 : 70), t, sc.t0 + BEAT * 2, ex, V ? 38 : 34);
  return { bottom, ex };
}
/* accent text with a small north-east arrow */
function linkLine(s, x, y, t, t0, ex, size = 34) {
  const u = eo3(prog(t, t0, 0.55)), a = u * (1 - ex); if (a <= 0.002) return;
  const yy = y + 18 * (1 - u) - 50 * ex;
  const w = T(s, x, yy, { size, weight: 600, fill: C.accent, alpha: a, ls: -0.005 * size });
  const k = size * 0.36, ax = x + w + size * 0.32, ay = yy - size * 0.36;
  g.save(); g.globalAlpha *= a; g.strokeStyle = C.accent; g.lineWidth = Math.max(2.4, size * 0.085); g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(ax, ay + k); g.lineTo(ax + k, ay); g.moveTo(ax + k * 0.3, ay); g.lineTo(ax + k, ay); g.lineTo(ax + k, ay + k * 0.7); g.stroke();
  g.restore();
}

// ---------- captures ("screen recording" windows) ----------
/* camera keys: [[beat, y, zoom, x]] in page CSS px; zoom 1 fits the page's crop (or full width) to the window */
function camAt(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { const a = keys[i - 1], b = keys[i], u = eio(prog(t, a[0], b[0] - a[0])); return [lerp(a[1], b[1], u), lerp(a[2], b[2], u), lerp(a[3], b[3], u)]; }
  }
  return keys[keys.length - 1].slice(1);
}
/* part of a capture: page CSS rect starting at (cx, cy), zoom z (screen px per CSS px), into screen rect (x, y, w, h) */
function drawCap(name, x, y, w, h, cx, cy, z) {
  const c = CAPS[name]; if (!c) return;
  const vx0 = cx, vx1 = cx + w / z, vy0 = cy, vy1 = cy + h / z;
  c.tiles.forEach((tl, i) => {
    const im = IMG['cap:' + name + '#' + i]; if (!im) return;
    const y0 = Math.max(vy0, tl.y), y1 = Math.min(vy1, tl.y + tl.h); if (y1 <= y0) return;
    const x0 = Math.max(vx0, 0), x1 = Math.min(vx1, c.w); if (x1 <= x0) return;
    const k = im.naturalWidth / c.w;
    g.drawImage(im, x0 * k, (y0 - tl.y) * k, (x1 - x0) * k, (y1 - y0) * k, x + (x0 - cx) * z, y + (y0 - cy) * z, (x1 - x0) * z, (y1 - y0) * z);
  });
}
/* draw a CSS rect of a capture at the same CSS position (inside siteWin's extra, where the transform is page coords) */
function capRect(name, x, y, w, h, alpha = 1) {
  const c = CAPS[name]; if (!c || alpha <= 0.002 || w <= 0 || h <= 0) return;
  g.save(); g.globalAlpha *= clamp(alpha);
  c.tiles.forEach((tl, i) => {
    const im = IMG['cap:' + name + '#' + i]; if (!im) return;
    const y0 = Math.max(y, tl.y), y1 = Math.min(y + h, tl.y + tl.h); if (y1 <= y0) return;
    const k = im.naturalWidth / c.w;
    g.drawImage(im, x * k, (y0 - tl.y) * k, w * k, (y1 - y0) * k, x, y0, w, y1 - y0);
  });
  g.restore();
}
const BAR = 54;
/* a browser-like window with the site's address bar; extra() draws overlays in page coords */
function siteWin(name, path, cam, o = {}) {
  const { alpha = 1, dx = 0, dy = 0, x = L.win.x, y = L.win.y, w = L.win.w, h = L.win.h, extra } = o;
  if (alpha <= 0.002) return;
  const [cx, cy, z] = cam;
  g.save(); g.globalAlpha *= clamp(alpha);
  g.translate(x + dx, y + dy);
  card(0, 0, w, h, { r: 26, fill: C.bg, shadow: 1.3 });
  g.save(); rr(0, 0, w, h, 26); g.clip();
  g.fillStyle = C.bar; g.fillRect(0, 0, w, BAR);
  g.fillStyle = C.barLine; g.fillRect(0, BAR - 1, w, 1);
  [0, 1, 2].forEach(i => { g.beginPath(); g.arc(30 + i * 22, BAR / 2, 6.5, 0, Math.PI * 2); g.fillStyle = C.dots; g.fill(); });
  const url = (VID.site.label + (path === '/' ? '/' : path)).slice(0, 70), pw = Math.min(w - 140, Math.max(420, tw(url, 18, 500, TEXT) + 56));
  rr(110, 11, pw, BAR - 22, 16); g.fillStyle = C.surface; g.fill();
  g.strokeStyle = C.soft; g.lineWidth = 1.6; g.beginPath(); g.arc(132, BAR / 2 - 2, 4.2, Math.PI, 0); g.stroke();
  g.fillStyle = C.soft; g.fillRect(126.5, BAR / 2 - 2, 11, 8.5);
  T(url, 148, BAR / 2 + 6.5, { size: 18, weight: 500, fam: TEXT, fill: C.muted });
  g.save(); g.beginPath(); g.rect(0, BAR, w, h - BAR); g.clip();
  g.fillStyle = C.bg; g.fillRect(0, BAR, w, h - BAR);
  drawCap(name, 0, BAR, w, h - BAR, cx, cy, z);
  if (extra) { g.translate(0, BAR); g.scale(z, z); g.translate(-cx, -cy); extra(); }
  g.restore();
  g.restore(); g.restore();
}
/* a phone with a mobile capture scrolled to scrollY (CSS px) */
function phone(name, cx, cy, scrollY, alpha, k = 1) {
  if (alpha <= 0.002) return;
  const sw = 400, sh = 866, bez = 14;
  const c = CAPS[name], z = c ? sw / c.w : 1;
  g.save(); g.globalAlpha *= alpha;
  g.translate(cx, cy); g.scale(k, k); g.translate(-cx, -cy);
  const x = cx - sw / 2, y = cy - sh / 2;
  g.shadowColor = 'rgba(0,0,0,0.22)'; g.shadowBlur = 60; g.shadowOffsetY = 24;
  rr(x - bez, y - bez, sw + 2 * bez, sh + 2 * bez, 66); g.fillStyle = C.phoneBody; g.fill(); g.shadowColor = 'transparent';
  rr(x - bez + 2, y - bez + 2, sw + 2 * bez - 4, sh + 2 * bez - 4, 64); g.strokeStyle = C.phoneRim; g.lineWidth = 2; g.stroke();
  g.save(); rr(x, y, sw, sh, 52); g.clip();
  g.fillStyle = C.bg; g.fillRect(x, y, sw, sh);
  const top = 52;
  const maxY = c ? Math.max(0, c.h - (sh - top) / z) : 0;
  drawCap(name, x, y + top, sw, sh - top, 0, clamp(scrollY, 0, maxY), z);
  g.fillStyle = C.status; g.fillRect(x, y, sw, top);
  T('9:41', x + 50, y + 34, { size: 17, weight: 600, fill: C.ink, fam: TEXT });
  g.fillStyle = C.ink; [0, 1, 2, 3].forEach(i => g.fillRect(x + sw - 98 + i * 6, y + 30 - 3 - i * 2.5, 4, 5 + i * 2.5));
  rr(x + sw - 64, y + 20, 26, 13, 4); g.strokeStyle = C.ink; g.lineWidth = 1.5; g.stroke(); g.fillRect(x + sw - 62, y + 22, 18, 9);
  rr(cx - 62, y + 12, 124, 34, 17); g.fillStyle = '#000'; g.fill();
  g.restore(); g.restore();
}
/* an image fitted into a box (contain), optionally zoomed around its centre */
function fitImage(key, x, y, w, h, alpha = 1, zoom = 1) {
  const im = IMG[key]; if (!im || alpha <= 0.002) return null;
  const s = Math.min(w / im.naturalWidth, h / im.naturalHeight) * zoom, iw = im.naturalWidth * s, ih = im.naturalHeight * s;
  g.save(); g.globalAlpha *= clamp(alpha); g.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); g.restore();
  return { x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih };
}
/* a logo by its height (keeps its own proportions) */
function logoAt(key, x, y, h, alpha = 1, align = 'left') {
  const im = IMG[key]; if (!im || alpha <= 0.002) return 0;
  const w = h * im.naturalWidth / im.naturalHeight, lx = align === 'center' ? x - w / 2 : x;
  g.save(); g.globalAlpha *= clamp(alpha); g.drawImage(im, lx, y, w, h); g.restore(); return w;
}
/* a logo by its width, centred on (cx, cy) */
function logoCentered(key, cx, cy, maxW, maxH, alpha = 1) {
  const im = IMG[key]; if (!im || alpha <= 0.002) return;
  const s = Math.min(maxW / im.naturalWidth, maxH / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
  g.save(); g.globalAlpha *= clamp(alpha); g.drawImage(im, cx - w / 2, cy - h / 2, w, h); g.restore();
}
