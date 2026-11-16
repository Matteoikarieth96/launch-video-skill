'use strict';
/* launch-video scene types. Every scene in video.json has "show" (what it puts on screen) and an optional title
   (lead, big, sub, link). back(t) draws the product layer, front(t) the titles and cards.
   show: text | page | phone | image | numbers | cards | code | logo | end (see references/storyboard.md). */
const SCN = VID.scenes.map(s => ({ ...s, t0: B(s.a), t1: B(s.b) }));
const PAGE = Object.fromEntries(VID.pages.map(p => [p.id, p]));
const logoKey = (l) => l ? 'logo:' + (DARK ? l.dark : l.light) : null;
const PRODUCT_LOGO = VID.product.logo ? 'logo:' + (DARK ? (VID.product.logoDark || VID.product.logo) : VID.product.logo) : null;
const live = (sc, t, pre = 0.3, post = 0.8) => t >= sc.t0 - pre && t <= sc.t1 + post;
const enter = (sc, t) => eo5(prog(t, sc.t0 - 0.15, 0.8));
const leave = (sc, t) => eio(prog(t, sc.t1 - 0.2, 0.6));

/* areas for images and card stacks */
const AREA = V ? { img: { x: 40, y: 720, w: 1000, h: 960 }, stack: { x: 80, w: 920, top: 760 }, code: { x: 80, y: 790, w: 920 } }
  : { img: { x: 820, y: 110, w: 1000, h: 860 }, stack: { x: 1000, w: 780, top: 0 }, code: { x: 1000, y: 0, w: 820 } };

/* the product's logo and name above a title ("brand": true) */
function brandRow(t, sc) {
  const ex = eio(prog(t, sc.t1 - 0.42, 0.42)), ua = clamp(prog(t, sc.t0 + 0.05, 0.3)), uw = eo3(prog(t, sc.t0 + 0.2, 0.6));
  const y = (V ? 120 : 200) - 50 * ex;
  const w = PRODUCT_LOGO ? logoAt(PRODUCT_LOGO, L.tx, y - 30 * (1 - ua), 104, ua * (1 - ex)) : 0;
  T(VID.product.name, L.tx + (w ? w + 16 : 0) + 14 * (1 - uw), y + 76, { size: 54, weight: 700, fill: C.ink, alpha: uw * (1 - ex), ls: -1.2 });
}
function sceneTitle(t, sc, o = {}) {
  if (!(sc.lead || sc.big || sc.sub)) return;
  if (sc.brand) brandRow(t, sc);
  return title(t, sc, { ...(sc.brand ? { cy: V ? 470 : 580 } : {}), ...o });
}

// ---------- text: a statement on its own ----------
const SHOW = {};
SHOW.text = {
  front(t, sc) { if (live(sc, t, 0, 0.1)) sceneTitle(t, sc, { wide: true }); },
};

// ---------- page: the site in a browser window, with a camera; optional typing and highlight ----------
SHOW.page = {
  back(t, sc) {
    if (!live(sc, t)) return;
    const c = CAPS[sc.page]; if (!c) return;
    const u = enter(sc, t), ex = leave(sc, t);
    const p = PAGE[sc.page], [x0, x1] = p.crop || [0, c.w], zFit = L.win.w / (x1 - x0);
    const keys = sc.camera.map(([b, y, z, x]) => [sc.t0 + B(b), y, zFit * z, x ?? x0 + (x1 - x0) * (1 - 1 / z) / 2]);
    const [cx, cy0, z] = camAt(keys.map(k => [k[0], k[3], k[1], k[2]]), t);
    const cy = clamp(cy0, 0, Math.max(0, c.h - (L.win.h - BAR) / z));   // never scroll past the end of the page
    let extra;
    if (sc.typing && c.input) {
      const ty = sc.typing, tt0 = sc.t0 + B(ty.at), tDone = tt0 + ty.text.length / ty.cps, tRes = tDone + 0.25;
      const typedName = sc.page + '@typed', after = CAPS[typedName];
      extra = () => {
        const ur = after ? eo3(prog(t, tRes, 0.45)) : 0;
        if (ur > 0) capRect(typedName, 0, cy, after.w, Math.min(after.h - cy, (L.win.h - BAR) / z + 4), ur);
        const box = ur > 0.5 && c.inputAfter ? c.inputAfter : c.input.box;
        const [ix, iy, , ih] = box, size = c.input.size;
        if (t >= tt0 - 0.05) {
          const s = typed(ty.text, t, tt0, ty.cps);
          const w = T(s, ix + c.input.padL, iy + ih / 2 + size * 0.36, { size, weight: c.input.weight, fam: c.input.family, fill: c.input.color || C.ink });
          caret(ix + c.input.padL + w + 1, iy + ih / 2 + size * 0.55, size * 1.25, t, C.accent, 1 - eo3(prog(t, tRes + 0.8, 0.3)));
        }
      };
    }
    if (sc.highlight && c.boxes && c.boxes[sc.highlight.box]) {
      const [bx, by, bw, bh] = c.boxes[sc.highlight.box], th = sc.t0 + B(sc.highlight.at), prev = extra;
      extra = () => {
        if (prev) prev();
        const ur = eo3(prog(t, th, 0.5)), press = Math.sin(Math.PI * clamp(prog(t, th + BEAT, 0.3)));
        if (ur > 0) {
          g.save(); g.globalAlpha *= ur;
          const pad = 6 + 3 * Math.sin(Math.PI * clamp(prog(t, th, 0.6))), r = Math.min(18, (bh + 2 * pad) / 2);
          rr(bx - pad, by - pad, bw + 2 * pad, bh + 2 * pad, r); g.strokeStyle = C.accent; g.lineWidth = 3 / z; g.stroke();
          g.restore();
        }
        if (press > 0) { rr(bx, by, bw, bh, Math.min(14, bh / 2)); g.fillStyle = `rgba(${rgbOf(C.accent)},${0.16 * press})`; g.fill(); }
      };
    }
    siteWin(sc.page, c.path || p.path, [cx, cy, z], { alpha: u * (1 - ex), dy: 160 * (1 - u), extra });
  },
  front(t, sc) { if (live(sc, t, 0, 0.1)) sceneTitle(t, sc); },
};

// ---------- phone: a mobile capture scrolling inside a phone ----------
SHOW.phone = {
  back(t, sc) {
    if (!live(sc, t)) return;
    const u = enter(sc, t), ex = leave(sc, t);
    const sy = lerp(sc.from, sc.to, eio(prog(t, sc.t0 + 0.7, Math.max(0.5, sc.t1 - sc.t0 - 0.6))));
    phone(sc.page, L.phone.cx, L.phone.cy + 380 * (1 - u) - 60 * ex, sy, u * (1 - ex), L.phone.k);
  },
  front(t, sc) { if (live(sc, t, 0, 0.1)) sceneTitle(t, sc); },
};

// ---------- image: your own picture (a map, a screenshot, a product shot) with a slow zoom ----------
SHOW.image = {
  back(t, sc) {
    if (!live(sc, t)) return;
    const u = enter(sc, t), ex = leave(sc, t), a = u * (1 - ex), A = AREA.img, dy = 120 * (1 - u) - 40 * ex;
    const zoom = lerp(1, 1.05, prog(t, sc.t0, sc.t1 - sc.t0 + 0.8));
    if (sc.frame === 'card') {
      const im = IMG['img:' + sc.src]; if (!im) return;
      const s = Math.min((A.w - 48) / im.naturalWidth, (A.h - 48) / im.naturalHeight), w = im.naturalWidth * s + 48, h = im.naturalHeight * s + 48;
      const x = A.x + (A.w - w) / 2, y = A.y + (A.h - h) / 2 + dy;
      card(x, y, w, h, { r: 28, alpha: a });
      g.save(); rr(x + 24, y + 24, w - 48, h - 48, 14); g.clip(); fitImage('img:' + sc.src, x + 24, y + 24, w - 48, h - 48, a, zoom); g.restore();
    } else fitImage('img:' + sc.src, A.x, A.y + dy, A.w, A.h, a, zoom);
  },
  front(t, sc) { if (live(sc, t, 0, 0.1)) sceneTitle(t, sc); },
};

// ---------- numbers: counters on cards, with an optional picture beside (or above, in 9:16) ----------
SHOW.numbers = {
  back(t, sc) {
    if (!sc.src || !live(sc, t, 0.4, 0.6)) return;
    const u = eo5(prog(t, sc.t0 - 0.1, 0.9)), ex = eio(prog(t, sc.t1 - 0.35, 0.7));
    const A = V ? { x: 80, y: 170, w: 920, h: 820 } : { x: 860, y: 110, w: 960, h: 860 };
    const k = lerp(0.95, 1, u);
    g.save(); g.translate(A.x + A.w / 2, A.y + A.h / 2 - (V ? 60 : 0) * ex); g.scale(k, k); g.translate(-(A.x + A.w / 2), -(A.y + A.h / 2));
    fitImage('img:' + sc.src, A.x, A.y, A.w, A.h, u * (1 - ex));
    g.restore();
  },
  front(t, sc) {
    if (!live(sc, t, 0, 0.1)) return;
    let x, w, top;
    const n = sc.items.length, h = V ? 124 : 132, gap = V ? 16 : 20, stackH = n * h + (n - 1) * gap;
    if (sc.src) { x = 80; w = V ? 920 : 660; top = V ? 1030 : (H - stackH) / 2; if (sc.big) WARN.add('numbers with an image show no title (the picture takes its place)'); }
    else { sceneTitle(t, sc); x = AREA.stack.x; w = AREA.stack.w; top = V ? AREA.stack.top : (H - stackH) / 2; }
    sc.items.forEach((it, i) => {
      const t0 = sc.t0 + B(it.at), ui = eo5(prog(t, t0 - 0.12, 0.6)), ex = eio(prog(t, sc.t1 - 0.5 + i * 0.03, 0.45));
      const a = ui * (1 - ex); if (a <= 0.002) return;
      const y = top + i * (h + gap) + 34 * (1 - ui) - 40 * ex;
      card(x, y, w, h, { r: 24, alpha: a, shadow: 0.9 });
      const final = it.prefix + fmtNum(it.value, it.decimals, sc.decimal) + it.suffix;
      const size = Math.min(66, fitSize(final, w - 70, 66, 700) * 0.92);
      const c = eo3(prog(t, t0, 1.0));
      const next = i < n - 1 ? eo3(prog(t, sc.t0 + B(sc.items[i + 1].at), 0.45)) : 0;
      numT(it.prefix + fmtNum(it.value * c, it.decimals, sc.decimal) + it.suffix, x + 32, y + 78, { size, weight: 700, fill: mix(C.accent, C.accent2, next), alpha: a });
      const lb = wrapFit(it.label, w - 68, 25, { maxLines: 1, minSize: 18, fam: TEXT });
      T(lb.lines[0], x + 34, y + 113, { size: lb.size, weight: 500, fill: C.soft, alpha: a, fam: TEXT });
    });
  },
};

// ---------- cards: up to 4 feature cards with an icon ----------
function icon(kind, cx, cy, a) {
  g.save(); g.globalAlpha *= a;
  g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.fillStyle = C.accentBg; g.fill();
  g.strokeStyle = C.accent; g.fillStyle = C.accent; g.lineWidth = 3.2; g.lineCap = 'round'; g.lineJoin = 'round';
  const P = pts => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(cx + x, cy + y) : g.moveTo(cx + x, cy + y)); };
  const ring = (x, y, r) => { g.beginPath(); g.arc(cx + x, cy + y, r, 0, Math.PI * 2); g.stroke(); };
  switch (kind) {
    case 'chart': [[-12, 8], [-1, 15], [10, 22]].forEach(([dx, h]) => { rr(cx + dx - 4, cy + 13 - h, 8, h, 2); g.fill(); }); P([[-17, 14], [17, 14]]); g.stroke(); break;
    case 'doc': rr(cx - 12, cy - 16, 24, 32, 4); g.stroke(); [-6, 0, 6].forEach(d => { P([[-6, d], [6, d]]); g.stroke(); }); break;
    case 'money': ring(0, 0, 15); T('$', cx, cy + 1, { size: 20, weight: 700, fill: C.accent, align: 'center', base: 'middle' }); break;
    case 'search': ring(-4, -4, 10); P([[4, 4], [14, 14]]); g.stroke(); break;
    case 'map': P([[-16, -10], [-5, -14], [5, -10], [16, -14], [16, 12], [5, 16], [-5, 12], [-16, 16]]); g.closePath(); g.stroke(); P([[-5, -14], [-5, 12]]); g.stroke(); P([[5, -10], [5, 16]]); g.stroke(); break;
    case 'lock': rr(cx - 13, cy - 3, 26, 19, 4); g.stroke(); g.beginPath(); g.arc(cx, cy - 4, 8, Math.PI, 0); g.stroke(); break;
    case 'bolt': P([[3, -17], [-10, 2], [0, 2], [-3, 17], [10, -2], [0, -2]]); g.closePath(); g.fill(); break;
    case 'check': P([[-12, 0], [-3, 9], [13, -9]]); g.stroke(); break;
    case 'star': { const p = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 7 : 16, an = -Math.PI / 2 + i * Math.PI / 5; p.push([r * Math.cos(an), r * Math.sin(an)]); } P(p); g.closePath(); g.fill(); break; }
    case 'globe': ring(0, 0, 15); g.beginPath(); g.ellipse(cx, cy, 6.5, 15, 0, 0, Math.PI * 2); g.stroke(); P([[-15, 0], [15, 0]]); g.stroke(); break;
    case 'phone': rr(cx - 9, cy - 16, 18, 32, 4); g.stroke(); P([[-3, 11], [3, 11]]); g.stroke(); break;
    case 'code': P([[-7, -9], [-15, 0], [-7, 9]]); g.stroke(); P([[7, -9], [15, 0], [7, 9]]); g.stroke(); break;
    case 'people': ring(-6, -6, 6); ring(8, -4, 5); g.beginPath(); g.arc(cx - 6, cy + 14, 11, Math.PI, 0); g.stroke(); g.beginPath(); g.arc(cx + 9, cy + 14, 8, Math.PI, 0); g.stroke(); break;
    case 'heart': g.beginPath(); g.moveTo(cx, cy + 13); g.bezierCurveTo(cx - 22, cy - 2, cx - 9, cy - 20, cx, cy - 7); g.bezierCurveTo(cx + 9, cy - 20, cx + 22, cy - 2, cx, cy + 13); g.fill(); break;
    case 'clock': ring(0, 0, 15); P([[0, -8], [0, 0], [7, 4]]); g.stroke(); break;
    case 'leaf': g.beginPath(); g.moveTo(cx - 13, cy + 13); g.quadraticCurveTo(cx - 14, cy - 14, cx + 14, cy - 14); g.quadraticCurveTo(cx + 14, cy + 13, cx - 13, cy + 13); g.stroke(); P([[-13, 13], [5, -5]]); g.stroke(); break;
  }
  g.restore();
}
SHOW.cards = {
  back(t, sc) {
    if (!live(sc, t, 0.3, 0.6)) return;
    const ex = eio(prog(t, sc.t1 - 0.35, 0.5)), n = sc.items.length, h = 150, gap = 26;
    const x = AREA.stack.x, w = AREA.stack.w, stackH = n * h + (n - 1) * gap + (sc.note ? 90 : 0);
    const top = V ? AREA.stack.top : Math.max(120, (H - stackH) / 2);
    const step = Math.min(1.5, (sc.beats - 2.5) / Math.max(1, n));
    sc.items.forEach((c, i) => {
      const t0 = sc.t0 + B(1 + step * i), u = eo5(prog(t, t0, 0.65)), a = u * (1 - ex);
      if (a <= 0.002) return;
      const y = top + i * (h + gap) + 50 * (1 - u) - 40 * ex;
      card(x, y, w, h, { r: 26, alpha: a });
      icon(c.icon, x + 82, y + h / 2, a * eback(clamp(prog(t, t0 + 0.1, 0.5))));
      const hd = wrapFit(c.title, w - 180, 38, { weight: 700, maxLines: 1, minSize: 28 });
      T(hd.lines[0], x + 146, y + (c.text ? 66 : 88), { size: hd.size, weight: 700, fill: C.ink, alpha: a, ls: -0.5 });
      if (c.text) { const tx = wrapFit(c.text, w - 180, 27, { maxLines: 1, minSize: 20, fam: TEXT }); T(tx.lines[0], x + 147, y + 108, { size: tx.size, weight: 500, fill: C.soft, alpha: a, fam: TEXT }); }
    });
    if (sc.note) {
      const ul = eo5(prog(t, sc.t0 + B(1 + step * n + 0.5), 0.6)), nt = wrapFit(sc.note, w, 34, { weight: 600, maxLines: 2, minSize: 24 });
      nt.lines.forEach((l, i) => T(l, x + 4, top + n * (h + gap) + 64 + i * nt.size * 1.3 + 24 * (1 - ul) - 40 * ex, { size: nt.size, weight: 600, fill: C.muted, alpha: ul * (1 - ex) }));
    }
  },
  front(t, sc) { if (live(sc, t, 0, 0.1)) sceneTitle(t, sc); },
};

// ---------- code: the repository address types itself over a few lines of code ----------
const HEXTOK = /#[0-9a-fA-F]{6}\b/;
const valFill = c => Math.abs(lum(c) - lum(C.card)) < 0.3 ? C.ink : c;
SHOW.code = {
  back(t, sc) {
    if (!live(sc, t, 0.3, 0.6)) return;
    const u = eo5(prog(t, sc.t0 + 0.1, 0.8)), ex = eio(prog(t, sc.t1 - 0.4, 0.5)), a = u * (1 - ex);
    if (a <= 0.002) return;
    const w = AREA.code.w, h = 196 + Math.max(3, sc.lines.length) * 46 + 30;
    const x = AREA.code.x, y = (V ? AREA.code.y : (H - h) / 2) + 120 * (1 - u) - 50 * ex;
    card(x, y, w, h, { r: 28, alpha: a });
    rr(x + 36, y + 36, w - 72, 78, 39); g.save(); g.globalAlpha *= a; g.fillStyle = C.surface; g.fill(); g.restore();
    T('</>', x + 68, y + 87, { size: 28, weight: 700, fill: C.accent, alpha: a, fam: MONO });
    const t0 = sc.t0 + B(1.4), s = typed(sc.repo, t, t0, 22);
    const size = Math.min(30, (w - 72 - 150) / (tw(sc.repo, 1, 500, MONO) || 1));
    const w1 = T(s, x + 136, y + 86, { size, weight: 500, fill: C.ink, alpha: a, fam: MONO });
    caret(x + 138 + w1, y + 90, 32, t, C.accent, a);
    const cs = Math.min(24, (w - 140) / Math.max(1, ...sc.lines.map(l => tw(l, 1, 500, MONO))));
    sc.lines.forEach((ln, i) => {
      const ui = eo3(prog(t, sc.t0 + 0.6 + i * 0.13, 0.45)), al = a * ui, ly = y + 196 + i * 46 + 12 * (1 - ui);
      T(String(i + 1), x + 70, ly, { size: 22, weight: 500, fill: C.lineNo, alpha: al, align: 'right', fam: MONO });
      const comment = /^\s*(\/\/|\/\*|#\s|--|\*)/.test(ln), m = ln.match(HEXTOK);
      if (comment || !m) { T(ln, x + 96, ly, { size: cs, weight: 500, fill: comment ? C.soft : C.ink, alpha: al, fam: MONO }); return; }
      const before = ln.slice(0, m.index), after = ln.slice(m.index);
      const wb = T(before, x + 96, ly, { size: cs, weight: 500, fill: C.muted, alpha: al, fam: MONO });
      g.save(); g.globalAlpha *= al; rr(x + 100 + wb, ly - cs * 0.8, cs * 0.92, cs * 0.92, 6); g.fillStyle = m[0]; g.fill(); g.strokeStyle = DARK ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.12)'; g.lineWidth = 1; g.stroke(); g.restore();
      T(after, x + 108 + wb + cs, ly, { size: cs, weight: 600, fill: valFill(m[0]), alpha: al, fam: MONO });
    });
  },
  front(t, sc) { if (live(sc, t, 0, 0.1)) sceneTitle(t, sc); },
};

// ---------- logo: a logo reveal with a caption ("presents") ----------
SHOW.logo = {
  back(t, sc) {
    if (!live(sc, t, 0.3, 0.5)) return;
    const ex = eio(prog(t, sc.t1 - 0.4, 0.55)), u = eo5(prog(t, sc.t0 + 0.08, 0.9));
    const cy = V ? 860 : 470;
    g.save(); g.translate(W / 2, cy - 40 * ex); const k = lerp(0.94, 1, u) * (1 + 0.04 * ex); g.scale(k, k);
    logoCentered(logoKey(sc.src), 0, 0, V ? 560 : 520, V ? 300 : 280, u * (1 - ex));
    g.restore();
    const up = eo3(prog(t, sc.t0 + B(1.5), 0.6));
    if (sc.caption) T(sc.caption, W / 2, (V ? 1140 : 750) + 20 * (1 - up) - 40 * ex, { size: 38, weight: 600, fill: C.soft, align: 'center', alpha: up * (1 - ex), ls: 0.5 });
  },
};

// ---------- end: the address, the repository, who made it, a credit line ----------
SHOW.end = {
  front(t, sc) {
    if (t < sc.t0 - 0.1) return;
    const cx = W / 2, dy = V ? 300 : 0, u = eo5(prog(t, sc.t0 + B(0.5), 0.9));
    const size = fitSize(sc.url, V ? 920 : 1500, 118, 800, -0.03);
    const hasMore = sc.repo || sc.by || sc.logo;
    const y0 = (hasMore ? 470 : 560) + dy;
    T(sc.url, cx, y0 + 40 * (1 - u), { size, weight: 800, fill: C.accent, align: 'center', alpha: u, ls: -0.03 * size });
    const ur = eo3(prog(t, sc.t0 + B(1.25), 0.7));
    if (sc.repo) T(sc.repo, cx, y0 + 86 + 12 * (1 - ur), { size: V ? 36 : 34, weight: 500, fill: C.muted, align: 'center', alpha: ur, fam: TEXT });
    const up = eo3(prog(t, sc.t0 + B(2), 0.6));
    if (sc.by) T(sc.by, cx, y0 + 210 + 16 * (1 - up), { size: 34, weight: 600, fill: C.soft, align: 'center', alpha: up });
    const ul = eo5(prog(t, sc.t0 + B(2.5), 0.8));
    if (sc.logo) { g.save(); g.translate(cx, y0 + (sc.by ? 350 : 280) + 24 * (1 - ul)); const k = lerp(0.94, 1, ul); g.scale(k, k); logoCentered(logoKey(sc.logo), 0, 0, 320, 170, ul); g.restore(); }
    if (sc.credit) {
      const uc = eo3(prog(t, sc.t0 + B(4), 0.8)), cr = wrapFit(sc.credit, V ? 900 : 1600, V ? 26 : 22, { maxLines: 3, minSize: 18, fam: TEXT });
      const cy0 = V ? 1430 : 1028 - (cr.lines.length - 1) * cr.size * 1.4;
      cr.lines.forEach((l, i) => T(l, cx, cy0 + i * cr.size * 1.4, { size: cr.size, weight: 500, fill: C.faint, align: 'center', alpha: uc, fam: TEXT }));
    }
  },
};

/* the title panel (16:9) is off for logo and end scenes */
function panelAlpha(t) {
  let off = 0;
  for (const sc of SCN) if (sc.show === 'logo' || sc.show === 'end') off = Math.max(off, eio(prog(t, sc.t0 - 0.3, 0.6)) * (sc.show === 'end' ? 1 : 1 - eio(prog(t, sc.t1 - 0.3, 0.6))));
  return 1 - off;
}
window.renderAt = function (t) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  background();
  for (const sc of SCN) SHOW[sc.show].back?.(t, sc);
  leftPanel(panelAlpha(t));
  for (const sc of SCN) SHOW[sc.show].front?.(t, sc);
};
window.TOTAL = TOTAL;
