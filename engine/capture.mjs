// launch-video capture: screenshots the real site (the pages in video.json) as tall PNG tiles, like a screen recording
// that the engine then pans, zooms and crops. Run from the video folder after `python3 engine/build.py`:
//   node engine/capture.mjs [--theme light|dark|all] [page ids ...]
// Out: captures/<theme>/<id>-<k>.png (2000 CSS px tall tiles) + captures/<theme>/meta.json and meta.js
// (sizes, tiles, element boxes in CSS px). A page with "typing" also gets <id>@typed: the page after the text was
// typed (and submitted), with the typed text made transparent so the engine can type it itself over the same pixels.
// Only the URLs listed in video.json are opened. Nothing on the page is clicked, no form is sent unless "submit" is set.
import { writeFileSync, readFileSync, existsSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTab, outDir } from './chrome.mjs';

const ENGINE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(ENGINE, '..');
const DATA = join(ROOT, 'build', 'data.json');
if (!existsSync(DATA)) { console.error('build/data.json missing: run python3 engine/build.py first'); process.exit(1); }
const VID = JSON.parse(readFileSync(DATA, 'utf8'));
const args = process.argv.slice(2), ids = [];
let themeArg = 'all';
for (let i = 0; i < args.length; i++) { if (args[i] === '--theme') themeArg = args[++i]; else ids.push(args[i]); }
const THEMES = themeArg === 'all' ? VID.themes : themeArg.split(',');
for (const t of THEMES) if (!VID.themes.includes(t)) { console.error(`theme ${t} is not in video.json themes`); process.exit(1); }
const PAGES = VID.pages.filter(p => p.url && (!ids.length || ids.includes(p.id)));
for (const id of ids) if (!VID.pages.some(p => p.id === id)) { console.error('no page with id ' + id); process.exit(1); }
const TILE = 2000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = e => { console.error('capture failed:', e?.message || e); process.exit(1); };
process.on('unhandledRejection', fail);

const NO_MOTION = '*,*::before,*::after{transition:none!important;animation-delay:-1ms!important;animation-duration:1ms!important;animation-iteration-count:1!important;caret-color:transparent!important;scroll-behavior:auto!important}';

async function load(tab, p, theme) {
  await tab.S('Emulation.setDeviceMetricsOverride', { width: p.width, height: p.mobile ? 844 : 900, deviceScaleFactor: p.dsf, mobile: p.mobile });
  await tab.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  const loaded = tab.once('Page.loadEventFired', 90000);
  const nav = await tab.S('Page.navigate', { url: p.url });
  if (nav.errorText) throw new Error(`${p.url}: ${nav.errorText}`);
  await loaded;
  await prepare(tab, p, theme);
}
async function prepare(tab, p, theme) {
  if (p.themeAttribute) await tab.ev(`document.documentElement.setAttribute(${JSON.stringify(p.themeAttribute)}, ${JSON.stringify(theme)})`);
  const css = NO_MOTION + p.hide.map(s => `${s}{visibility:hidden!important}`).join('') + (p.css || '');
  await tab.ev(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); })()`);
  // scroll through the page so lazy parts (images, charts, maps) are drawn, then back to the top
  await tab.ev(`(async () => { const H = Math.min(document.documentElement.scrollHeight, ${p.maxHeight});
    for (let y = 0; y < H; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); })()`);
  await sleep(p.wait);
  await tab.ev('document.fonts.ready.then(() => true)');
}
// element boxes in page CSS px: {name: [x, y, w, h]}; "text:TAG|Starts with" finds an element by its text
async function boxes(tab, sel) {
  return tab.ev(`(() => { const sel = ${JSON.stringify(sel)}, r = {};
    for (const [k, s] of Object.entries(sel)) {
      let el;
      if (s.startsWith('text:')) { const [tag, txt] = s.slice(5).split('|'); el = [...document.querySelectorAll(tag)].find(e => e.textContent.trim().startsWith(txt)); }
      else el = document.querySelector(s);
      if (!el) { r[k] = null; continue; }
      const b = el.getBoundingClientRect();
      r[k] = [b.x + scrollX, b.y + scrollY, b.width, b.height].map(v => Math.round(v * 10) / 10);
    } return r; })()`);
}
async function tiles(tab, dir, theme, name, w, h, dsf) {
  const out = [];
  for (let y = 0, k = 0; y < h; y += TILE, k++) {
    const th = Math.min(TILE, h - y);
    const { data } = await tab.S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y, width: w, height: th, scale: 1 } });
    const file = `${name.replace('@', '__')}-${k}.png`;
    writeFileSync(join(dir, file), Buffer.from(data, 'base64'));
    out.push({ src: `captures/${theme}/${file}`, y, h: th });
  }
  return { w, h, dsf, tiles: out };
}

async function one(tab, p, theme, dir, META) {
  await load(tab, p, theme);
  const [sw, sh] = await tab.ev('[document.documentElement.scrollWidth, document.documentElement.scrollHeight]');
  const w = p.width, h = Math.min(Math.max(sh, 1), p.maxHeight);
  if (sw > w + 4) console.warn(`  note: ${p.id} is ${sw} px wide at a ${w} px viewport (content wider than the screen)`);
  const bg = await tab.ev('getComputedStyle(document.body).backgroundColor');
  const lum = (bg.match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0) / 255;
  if (theme === 'dark' && lum > 0.6 && !/rgba\(0, 0, 0, 0\)/.test(bg)) console.warn(`  WARNING: ${p.id} looks light in the dark theme (body ${bg}): the site may not follow prefers-color-scheme; set "themeAttribute" if it uses one`);
  const sel = { ...p.boxes }; if (p.typing) sel.__input = p.typing.selector;
  const b = await boxes(tab, sel);
  for (const [k, v] of Object.entries(b)) if (!v && k !== '__input') console.warn(`  WARNING: ${p.id}: box "${k}" (${sel[k]}) not found`);
  const entry = { ...(await tiles(tab, dir, theme, p.id, w, h, p.dsf)), boxes: b, bg, path: p.path };
  if (p.typing) {
    if (!b.__input) throw new Error(`${p.id}: typing selector ${p.typing.selector} not found`);
    const sel = JSON.stringify(p.typing.selector);
    entry.input = await tab.ev(`(() => { const i = document.querySelector(${sel}), s = getComputedStyle(i), r = i.getBoundingClientRect();
      return { box: [r.x + scrollX, r.y + scrollY, r.width, r.height].map(v => Math.round(v * 10) / 10), size: parseFloat(s.fontSize),
        weight: s.fontWeight, family: s.fontFamily, padL: parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth), color: s.color }; })()`);
    await tab.ev(`(() => { const i = document.querySelector(${sel}); i.focus(); i.scrollIntoView({ block: 'center' }); })()`);
    await tab.S('Input.insertText', { text: p.typing.text });
    if (p.typing.submit) {
      const nav = tab.once('Page.loadEventFired', 20000).catch(() => null);
      for (const type of ['keyDown', 'keyUp']) await tab.S('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
      await Promise.race([nav, sleep(2500)]);
      await prepare(tab, p, theme);
    } else await sleep(p.wait);
    await tab.ev('window.scrollTo(0, 0)');
    const b2 = await boxes(tab, { ...p.boxes, __input: p.typing.selector });
    await tab.ev(`(() => { const i = document.querySelector(${sel}); if (i) { i.style.setProperty('color', 'transparent', 'important'); i.style.setProperty('-webkit-text-fill-color', 'transparent', 'important'); i.blur(); } })()`);
    await sleep(200);
    const [, sh2] = await tab.ev('[0, document.documentElement.scrollHeight]');
    META[p.id + '@typed'] = { ...(await tiles(tab, dir, theme, p.id + '@typed', w, Math.min(sh2, p.maxHeight), p.dsf)), boxes: b2, path: p.path };
    if (b2.__input) entry.inputAfter = b2.__input;
  }
  META[p.id] = entry;
  console.log(`capture ${theme} ${p.id}  ${w}x${h} css px  ${entry.tiles.length} tile(s)${p.typing ? ' + typed' : ''}`);
}

if (!PAGES.length) { console.log('no pages to capture (pages with "image" use your own screenshot)'); process.exit(0); }
for (const theme of THEMES) {
  const dir = outDir(ROOT, 'captures', theme);
  const metaFile = join(dir, 'meta.json');
  const META = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
  // remove the old tiles of the pages captured again (a page can get shorter)
  const TILE_RE = id => new RegExp('^' + id + '(__typed)?-\\d+\\.png$');
  for (const p of PAGES) for (const f of readdirSync(dir)) if (TILE_RE(p.id).test(f) && lstatSync(join(dir, f)).isFile()) rmSync(join(dir, f));
  const tab = await openTab();
  try { for (const p of PAGES) await one(tab, p, theme, dir, META); }
  finally {
    await tab.close();
    writeFileSync(metaFile, JSON.stringify(META, null, 1));
    writeFileSync(join(dir, 'meta.js'), 'window.CAPTURES = window.CAPTURES || {}; window.CAPTURES[' + JSON.stringify(theme) + '] = ' + JSON.stringify(META).replace(/</g, '\\u003c') + ';\n');
  }
}
console.log('done: captures/<theme>/meta.json');
process.exit(0);
